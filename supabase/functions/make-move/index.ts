/**
 * make-move Edge Function
 * 
 * Server-side move validation and processing.
 * This function validates EVERY move before it's recorded to prevent cheating.
 * 
 * VALIDATION CHECKS:
 * 1. Match exists and is active
 * 2. It's the correct player's turn
 * 3. The position is empty (not already played)
 * 4. The player is actually in this match
 * 5. The position is valid (0-8)
 * 
 * If validation passes, the function:
 * 1. Records the move in the moves table
 * 2. Updates the match board_state
 * 3. Switches the current_turn
 * 4. Checks for a winner or draw
 * 5. If game over, marks match as completed
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

// Winning lines for Tic-Tac-Toe
const WINNING_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],  // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],  // columns
    [0, 4, 8], [2, 4, 6],              // diagonals
];

/**
 * Check if there's a winner on the board
 */
function checkWinner(board: string): string | null {
    for (const line of WINNING_LINES) {
        const [a, b, c] = line;
        const symbol = board[a];
        if (symbol !== '-' && symbol === board[b] && symbol === board[c]) {
            return symbol;
        }
    }
    return null;
}

/**
 * Check if the board is full (draw)
 */
function isDraw(board: string): boolean {
    return !board.includes('-');
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

async function resolvePlayerId(supabase: any, initData: string): Promise<string | null> {
    const telegramUser = extractTelegramUser(initData);
    const telegramId = telegramUser?.id?.toString();

    if (!telegramId) {
        return null;
    }

    const { data: user, error } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', telegramId)
        .single();

    if (error || !user?.id) {
        return null;
    }

    return user.id;
}

// Main request handler
serve(async (req: Request) => {
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
        // Create Supabase admin client (bypasses RLS)
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Parse request body
        const botToken = Deno.env.get('BOT_TOKEN');
        if (!botToken) {
            return new Response(
                JSON.stringify({ error: 'Server configuration error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const body = await req.json();
        const { match_id, position, initData } = body;

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

        const player_id = await resolvePlayerId(supabase, initData);
        if (!player_id) {
            return new Response(
                JSON.stringify({ error: 'Unable to resolve player identity' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ====== VALIDATION ======

        // Check required fields
        if (!match_id || position === undefined) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: match_id, position' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Validate position range
        if (position < 0 || position > 8) {
            return new Response(
                JSON.stringify({ error: 'Position must be between 0 and 8' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );

        }

        // Fetch the match
        const { data: match, error: matchError } = await supabase
            .from('matches')
            .select('*')
            .eq('id', match_id)
            .single();

        if (matchError || !match) {
            return new Response(
                JSON.stringify({ error: 'Match not found' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Check match is active
        if (match.status !== 'active') {
            return new Response(
                JSON.stringify({ error: `Match is ${match.status}, not active` }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Check player is in this match
        const isPlayerX = match.player_x === player_id;
        const isPlayerO = match.player_o === player_id;

        if (!isPlayerX && !isPlayerO) {
            return new Response(
                JSON.stringify({ error: 'You are not a player in this match' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Determine which symbol the player is
        const playerSymbol = isPlayerX ? 'X' : 'O';

        // Check it's the correct turn
        if (match.current_turn !== playerSymbol) {
            return new Response(
                JSON.stringify({ error: `It's ${match.current_turn}'s turn, not ${playerSymbol}'s` }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Check position is empty
        if (match.board_state[position] !== '-') {
            return new Response(
                JSON.stringify({ error: 'Position already taken' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Check position hasn't been played before (extra safety)
        const { data: existingMove } = await supabase
            .from('moves')
            .select('id')
            .eq('match_id', match_id)
            .eq('position', position)
            .single();

        if (existingMove) {
            return new Response(
                JSON.stringify({ error: 'Position already has a recorded move' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ====== PROCESS MOVE ======

        // Update the board
        const boardArray = match.board_state.split('');
        boardArray[position] = playerSymbol;
        const newBoard = boardArray.join('');
        const newTurn = playerSymbol === 'X' ? 'O' : 'X';

        // Record the move
        const { error: moveError } = await supabase
            .from('moves')
            .insert([{
                match_id: match_id,
                player_id: player_id,
                position: position,
            }]);

        if (moveError) {
            console.error('Error recording move:', moveError);
            return new Response(
                JSON.stringify({ error: 'Failed to record move' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Check for winner or draw
        const winner = checkWinner(newBoard);
        const boardFull = isDraw(newBoard);

        let matchUpdates: any = {
            board_state: newBoard,
            current_turn: newTurn,
        };

        let responseData: any = {
            success: true,
            position: position,
            symbol: playerSymbol,
            board: newBoard,
            current_turn: newTurn,
            game_over: false,
        };

        // If someone won
        if (winner) {
            const winnerId = winner === 'X' ? match.player_x : match.player_o;
            matchUpdates.status = 'completed';
            matchUpdates.winner = winnerId;
            responseData.game_over = true;
            responseData.winner = winner;
            responseData.winner_id = winnerId;
        }

        // If draw
        if (boardFull && !winner) {
            matchUpdates.status = 'completed';
            matchUpdates.winner = null;
            responseData.game_over = true;
            responseData.draw = true;
        }

        // Update the match
        const { error: updateError } = await supabase
            .from('matches')
            .update(matchUpdates)
            .eq('id', match_id);

        if (updateError) {
            console.error('Error updating match:', updateError);
            return new Response(
                JSON.stringify({ error: 'Failed to update match' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Return success response
        return new Response(
            JSON.stringify(responseData),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Error in make-move function:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
