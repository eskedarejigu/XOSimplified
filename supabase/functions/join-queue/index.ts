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
    'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_AUTH_AGE_SECONDS = 120;

// Supabase admin client
function getSupabase() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    return createClient(supabaseUrl, supabaseServiceKey);
}

async function verifyInitData(initData: string, botToken: string): Promise<boolean> {
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');

        if (!hash) {
            return false;
        }

        params.delete('hash');

        const sortedParams = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b));

        const dataCheckString = sortedParams
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        const encoder = new TextEncoder();
        const webAppDataKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode('WebAppData'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const secretBytes = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(botToken));

        const signatureKey = await crypto.subtle.importKey(
            'raw',
            secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(dataCheckString));

        const computedHash = Array.from(new Uint8Array(signature))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');

        return computedHash === hash;
    } catch {
        return false;
    }
}

function extractTelegramUser(initData: string): any {
    try {
        const params = new URLSearchParams(initData);
        const userJson = params.get('user');
        return userJson ? JSON.parse(userJson) : null;
    } catch {
        return null;
    }
}

function isFreshAuthDate(initData: string): boolean {
    const params = new URLSearchParams(initData);
    const authDateRaw = params.get('auth_date');

    if (!authDateRaw) {
        return false;
    }

    const authDate = Number(authDateRaw);
    if (!Number.isFinite(authDate)) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return now - authDate <= MAX_AUTH_AGE_SECONDS;
}

async function resolveAppUserId(supabase: any, initData: string) {
    const telegramUser = extractTelegramUser(initData);
    const telegramId = telegramUser?.id?.toString();

    if (!telegramId) {
        return { userId: null, error: 'Telegram user id is missing' };
    }

    const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', telegramId)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
        return { userId: null, error: 'Failed to resolve app user' };
    }

    if (existingUser?.id) {
        return { userId: existingUser.id, error: null };
    }

    const { data: createdUser, error: insertError } = await supabase
        .from('users')
        .insert([{
            telegram_id: telegramId,
            username: telegramUser.username || null,
            first_name: telegramUser.first_name || 'Player',
            photo_url: telegramUser.photo_url || null,
        }])
        .select('id')
        .single();

    if (insertError || !createdUser?.id) {
        return { userId: null, error: 'Failed to create app user' };
    }

    return { userId: createdUser.id, error: null };
}

/**
 * Join the waiting queue
 */
async function handleJoinQueue(supabase: any, userId: string) {
    // Check if user is already in queue
    const { data: existing } = await supabase
        .from('waiting_queue')
        .select('id')
        .eq('user_id', userId)
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
        .insert([{ user_id: userId }])
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
async function handleFindOpponent(supabase: any, userId: string) {
    // Find the oldest waiting player (FIFO)
    const { data: opponent, error } = await supabase
        .from('waiting_queue')
        .select('*')
        .neq('user_id', userId)
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
    const playerX = coinFlip ? userId : opponent.user_id;
    const playerO = coinFlip ? opponent.user_id : userId;

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
            you_are_x: playerX === userId,
        },
        status: 200,
    };
}

/**
 * Leave the waiting queue
 */
async function handleLeaveQueue(supabase: any, userId: string) {
    const { error } = await supabase
        .from('waiting_queue')
        .delete()
        .eq('user_id', userId);

    if (error) {
        console.error('Error leaving queue:', error);
        return { error: 'Failed to leave queue', status: 500 };
    }

    return { data: { left: true }, status: 200 };
}

/**
 * Check if a user is in the queue
 */
async function handleCheckQueue(supabase: any, userId: string) {
    const { data, error } = await supabase
        .from('waiting_queue')
        .select('id, joined_at')
        .eq('user_id', userId)
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
        const botToken = Deno.env.get('BOT_TOKEN');
        if (!botToken) {
            return new Response(
                JSON.stringify({ error: 'Server configuration error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const body = await req.json();
        const { action, initData } = body;

        if (!initData) {
            return new Response(
                JSON.stringify({ error: 'Missing initData' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const isValid = await verifyInitData(initData, botToken);
        if (!isValid || !isFreshAuthDate(initData)) {
            return new Response(
                JSON.stringify({ error: 'Invalid Telegram authentication' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = getSupabase();
        const { userId, error: userError } = await resolveAppUserId(supabase, initData);
        if (userError || !userId) {
            return new Response(
                JSON.stringify({ error: userError || 'Unable to resolve user' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        let result;

        switch (action) {
            case 'join':
                result = await handleJoinQueue(supabase, userId);
                break;
            case 'find-opponent':
                result = await handleFindOpponent(supabase, userId);
                break;
            case 'leave':
                result = await handleLeaveQueue(supabase, userId);
                break;
            case 'check':
                result = await handleCheckQueue(supabase, userId);
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
