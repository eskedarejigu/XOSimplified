/**
 * verify-telegram Edge Function
 * 
 * Verifies that Telegram initData is authentic by checking the HMAC signature.
 * This prevents users from faking their Telegram identity.
 * 
 * HOW IT WORKS:
 * 1. Telegram sends initData with a 'hash' field
 * 2. We sort all other fields alphabetically
 * 3. We compute HMAC-SHA256 using the bot token as key
 * 4. If our computed hash matches Telegram's hash, the data is authentic
 * 
 * DEPLOYMENT:
 * Set BOT_TOKEN environment variable in Supabase Dashboard
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// CORS headers for browser requests
const corsHeaders = {
    'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_AUTH_AGE_SECONDS = 120;

function getSupabase() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    return createClient(supabaseUrl, serviceRoleKey);
}

/**
 * Verify Telegram WebApp initData
 * @param initData - The raw initData string from Telegram
 * @param botToken - Your Telegram bot token
 * @returns boolean - Whether the initData is authentic
 */
async function verifyInitData(initData: string, botToken: string): Promise<boolean> {
    try {
        // Parse the initData string
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');

        if (!hash) {
            console.error('No hash found in initData');
            return false;
        }

        // Remove the hash from the data
        params.delete('hash');

        // Sort parameters alphabetically
        const sortedParams = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b));

        // Create data-check-string: key=value\nkey=value...
        const dataCheckString = sortedParams
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        // Step 1: Create secret key from bot token
        // HMAC-SHA256(key="WebAppData", message=bot_token)
        const encoder = new TextEncoder();
        const webAppDataKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode('WebAppData'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const secretBytes = await crypto.subtle.sign(
            'HMAC',
            webAppDataKey,
            encoder.encode(botToken)
        );

        // Step 2: Compute signature
        // HMAC-SHA256(key=secret, message=data_check_string)
        const signatureKey = await crypto.subtle.importKey(
            'raw',
            secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign(
            'HMAC',
            signatureKey,
            encoder.encode(dataCheckString)
        );

        // Convert signature to hex string
        const computedHash = Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // Compare computed hash with provided hash
        return computedHash === hash;

    } catch (error) {
        console.error('Error verifying initData:', error);
        return false;
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

/**
 * Extract user data from initData
 */
function extractUser(initData: string): any {
    try {
        const params = new URLSearchParams(initData);
        const userJson = params.get('user');

        if (userJson) {
            return JSON.parse(userJson);
        }

        return null;
    } catch {
        return null;
    }
}

async function upsertAppUser(telegramUser: any) {
    const supabase = getSupabase();
    const telegramId = telegramUser.id?.toString();

    if (!telegramId) {
        return { data: null, error: { message: 'Telegram user id is missing' } };
    }

    const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
        return { data: null, error: fetchError };
    }

    const userPayload = {
        telegram_id: telegramId,
        username: telegramUser.username || null,
        first_name: telegramUser.first_name || 'Player',
        photo_url: telegramUser.photo_url || null,
    };

    if (existingUser) {
        const { data, error } = await supabase
            .from('users')
            .update(userPayload)
            .eq('id', existingUser.id)
            .select()
            .single();

        return { data, error };
    }

    const { data, error } = await supabase
        .from('users')
        .insert([userPayload])
        .select()
        .single();

    return { data, error };
}

// Main request handler
serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // Only accept POST requests
    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        // Get the bot token from environment variables
        const botToken = Deno.env.get('BOT_TOKEN');

        if (!botToken) {
            console.error('BOT_TOKEN environment variable not set');
            return new Response(
                JSON.stringify({ error: 'Server configuration error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body
        const body = await req.json();
        const { initData } = body;

        if (!initData) {
            return new Response(
                JSON.stringify({ error: 'Missing initData' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Verify the initData signature and timestamp freshness
        const isValid = await verifyInitData(initData, botToken);

        if (!isValid) {
            return new Response(
                JSON.stringify({ 
                    valid: false, 
                    error: 'Invalid initData signature' 
                }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (!isFreshAuthDate(initData)) {
            return new Response(
                JSON.stringify({
                    valid: false,
                    error: 'Expired Telegram auth payload',
                }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Extract user data
        const user = extractUser(initData);

        if (!user) {
            return new Response(
                JSON.stringify({ valid: false, error: 'Missing Telegram user payload' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const { data: appUser, error: appUserError } = await upsertAppUser(user);

        if (appUserError || !appUser) {
            return new Response(
                JSON.stringify({ error: 'Failed to sync app user' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({
                valid: true,
                user: user,
                appUser: appUser,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Error in verify-telegram function:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
