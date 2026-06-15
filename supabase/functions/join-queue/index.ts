/**
 * join-queue Edge Function
 * 
 * Handles matchmaking queue operations:
 * 1. Join the waiting queue
 * 2. Find an opponent already in the queue
 * 3. Create a match when two players are found
 * 4. Leave the queue
 * 
 * This runs on the server to prevent race conditions where
 * two players might match with the same opponent.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Supabase admin client
function getSupabase() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Join the waiting queue
 */
async function handleJoinQueue(body: any) {
    const { user_id } = body;

    if (!user_id) {
        return { error: 'Missing user_id', status: 400 };
    }

    const supabase = getSupabase();

    // Check if user is already in queue
    const { data: existing } = await supabase
        .from('waiting_queue')
        .select('id')
        .eq('user_id', user_id)
        .single();

    if (existing) {
        return { 
            data: { queued: true, message: 'Already in queue' }, 
            status: 200 
        };
    }

    // Add to queue
    const { data, error } = await supabase
        .from('waiting_queue')
        .insert([{ user_id }])
        .select()
        .single();

    if (error) {
        console.error('Error joining queue:', error);
        return { error: 'Failed to join queue', status: 500 };
    }

    return { data: { queued: true, entry: data }, status: 200 };
}

/**
 * Find an opponent in the queue and create a match
 */
async function handleFindOpponent(body: any) {
    const { user_id } = body;

    if (!user_id) {
        return { error: 'Missing user_id', status: 400 };
    }

    const supabase = getSupabase();

    // Find the oldest waiting player (FIFO)
    const { data: opponent, error } = await supabase
        .from('waiting_queue')
        .select('*')
        .neq('user_id', user_id)
        .order('joined_at', { ascending: true })
        .limit(1)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            // No opponent found
            return { 
                data: { found: false, message: 'No opponent available' }, 
                status: 200 
            };
        }
        console.error('Error finding opponent:', error);
        return { error: 'Failed to find opponent', status: 500 };
    }

    if (!opponent) {
        return { 
            data: { found: false, message: 'No opponent available' }, 
            status: 200 
        };
    }

    // Found an opponent! Create a match.
    // Randomly assign X and O
    const coinFlip = Math.random() < 0.5;
    const playerX = coinFlip ? user_id : opponent.user_id;
    const playerO = coinFlip ? opponent.user_id : user_id;

    // Remove opponent from queue FIRST (to prevent double-matching)
    const { error: deleteError } = await supabase
        .from('waiting_queue')
        .delete()
        .eq('id', opponent.id);

    if (deleteError) {
        console.error('Error removing opponent from queue:', deleteError);
    }

    // Create the match
    const { data: match, error: matchError } = await supabase
        .from('matches')
        .insert([{
            player_x: playerX,
            player_o: playerO,
            board_state: '---------',
            current_turn: 'X',
            status: 'active',
        }])
        .select()
        .single();

    if (matchError) {
        console.error('Error creating match:', matchError);
        return { error: 'Failed to create match', status: 500 };
    }

    return {
        data: {
            found: true,
            match: match,
            you_are_x: playerX === user_id,
        },
        status: 200,
    };
}

/**
 * Leave the waiting queue
 */
async function handleLeaveQueue(body: any) {
    const { user_id } = body;

    if (!user_id) {
        return { error: 'Missing user_id', status: 400 };
    }

    const supabase = getSupabase();

    const { error } = await supabase
        .from('waiting_queue')
        .delete()
        .eq('user_id', user_id);

    if (error) {
        console.error('Error leaving queue:', error);
        return { error: 'Failed to leave queue', status: 500 };
    }

    return { data: { left: true }, status: 200 };
}

/**
 * Check if a user is in the queue
 */
async function handleCheckQueue(body: any) {
    const { user_id } = body;

    if (!user_id) {
        return { error: 'Missing user_id', status: 400 };
    }

    const supabase = getSupabase();

    const { data, error } = await supabase
        .from('waiting_queue')
        .select('id, joined_at')
        .eq('user_id', user_id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            return { data: { inQueue: false }, status: 200 };
        }
        return { error: 'Failed to check queue', status: 500 };
    }

    return { data: { inQueue: true, joinedAt: data.joined_at }, status: 200 };
}

// Main request handler
serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const body = await req.json();
        const { action } = body;

        let result;

        switch (action) {
            case 'join':
                result = await handleJoinQueue(body);
                break;
            case 'find-opponent':
                result = await handleFindOpponent(body);
                break;
            case 'leave':
                result = await handleLeaveQueue(body);
                break;
            case 'check':
                result = await handleCheckQueue(body);
                break;
            default:
                return new Response(
                    JSON.stringify({ 
                        error: 'Invalid action. Use: join, find-opponent, leave, check' 
                    }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
        }

        if (result.error) {
            return new Response(
                JSON.stringify({ error: result.error }),
                { status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify(result.data),
            { status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Error in join-queue function:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
