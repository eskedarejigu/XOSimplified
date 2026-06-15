/**
 * supabase.js - Supabase Client Configuration
 * 
 * This file creates and exports the Supabase client that we use
 * throughout the app to connect to our PostgreSQL database.
 * 
 * We use the UMD build loaded from CDN in index.html, so we access
 * it via the global 'supabase' object.
 */

// ======== CONFIGURATION ========
// These values come from environment variables or are hardcoded for now.
// In production on Vercel, you'll set these as Environment Variables.
const SUPABASE_URL = window.ENV?.SUPABASE_URL || 'https://ymyiqkbfpwlxggxjzycq.supabase.co';
const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlteWlxa2JmcHdseGdneGp6eWNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0OTY5MjgsImV4cCI6MjA5NzA3MjkyOH0.LvIcdfUY47prOaIl6hfoB6JmWa0mISYmbtQd7661Yno';

// ======== CREATE CLIENT ========
// Create a single Supabase client for the entire app.
// We use createClient from the global supabase object (UMD build).
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // Realtime configuration - we want realtime updates for matches
    realtime: {
        // Enable realtime by default
        params: {
            // How long to wait before timing out (in ms)
            timeout: 20000,
        },
    },
    // Auth configuration
    auth: {
        // Don't auto-refresh tokens - we use Telegram auth
        autoRefreshToken: false,
        // Don't persist session - Telegram handles this
        persistSession: false,
    },
});

/**
 * Get the current Supabase client instance.
 * Use this function whenever you need to access Supabase.
 * 
 * Example:
 *   const { data, error } = await getSupabase().from('users').select('*');
 */
function getSupabase() {
    return supabaseClient;
}

/**
 * Check if Supabase is properly configured.
 * Returns true if the URL and key are set correctly.
 */
function isSupabaseConfigured() {
    return SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20;
}

/**
 * Test the Supabase connection.
 * Useful for showing connection status on the home screen.
 */
async function testSupabaseConnection() {
    try {
        // Try a simple query to test the connection
        const { data, error } = await supabaseClient.from('users').select('count', { count: 'exact', head: true });
        
        if (error) {
            console.error('Supabase connection test failed:', error);
            return false;
        }
        
        return true;
    } catch (err) {
        console.error('Supabase connection error:', err);
        return false;
    }
}

// ======== REALTIME CHANNEL MANAGEMENT ========
// We keep track of active channels so we can unsubscribe cleanly
const activeChannels = new Map();

/**
 * Subscribe to a realtime channel.
 * This wraps Supabase realtime with proper cleanup.
 * 
 * @param {string} channelName - Unique name for this channel
 * @param {string} table - Table to watch
 * @param {string} event - Event type: INSERT, UPDATE, DELETE, or *
 * @param {Function} callback - Function to call when event fires
 * @param {Object} filter - Optional filter, e.g., { column: 'id', value: '123' }
 */
function subscribeToChannel(channelName, table, event, callback, filter = null) {
    // Unsubscribe from any existing channel with the same name
    unsubscribeFromChannel(channelName);

    // Create a new channel
    const channel = supabaseClient
        .channel(channelName)
        .on(
            'postgres_changes',
            {
                event: event,        // INSERT, UPDATE, DELETE, or *
                schema: 'public',
                table: table,
                filter: filter ? `${filter.column}=eq.${filter.value}` : undefined,
            },
            (payload) => {
                // Call the user's callback with the payload
                callback(payload);
            }
        )
        .subscribe((status) => {
            console.log(`Channel ${channelName} status:`, status);
        });

    // Store the channel for later cleanup
    activeChannels.set(channelName, channel);

    return channel;
}

/**
 * Unsubscribe from a specific channel.
 * Always call this when leaving a screen to avoid memory leaks.
 * 
 * @param {string} channelName - Name of the channel to unsubscribe
 */
function unsubscribeFromChannel(channelName) {
    const existingChannel = activeChannels.get(channelName);
    if (existingChannel) {
        existingChannel.unsubscribe();
        activeChannels.delete(channelName);
    }
}

/**
 * Unsubscribe from ALL active channels.
 * Call this when logging out or resetting the app.
 */
function unsubscribeAllChannels() {
    activeChannels.forEach((channel, name) => {
        channel.unsubscribe();
    });
    activeChannels.clear();
}

// ======== DATABASE HELPER FUNCTIONS ========
// These are simple wrappers around common Supabase operations

/**
 * Fetch a single user by their Telegram ID.
 * @param {string} telegramId - The Telegram user ID
 */
async function getUserByTelegramId(telegramId) {
    const { data, error } = await supabaseClient
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

    if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned, which is fine
        console.error('Error fetching user:', error);
    }

    return { data, error };
}

/**
 * Create a new user in the database.
 * @param {Object} userData - User data from Telegram
 */
async function createUser(userData) {
    const { data, error } = await supabaseClient
        .from('users')
        .insert([userData])
        .select()
        .single();

    if (error) {
        console.error('Error creating user:', error);
    }

    return { data, error };
}

/**
 * Update a user's stats (games played, wins, etc.)
 * @param {string} userId - UUID of the user
 * @param {Object} updates - Fields to update
 */
async function updateUserStats(userId, updates) {
    const { data, error } = await supabaseClient
        .from('users')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

    if (error) {
        console.error('Error updating user stats:', error);
    }

    return { data, error };
}

/**
 * Get or create a user (upsert operation).
 * This is the main function we call when a user logs in.
 * @param {Object} telegramUser - User data from Telegram WebApp
 */
async function getOrCreateUser(telegramUser) {
    // First, try to find the user by telegram_id
    const { data: existingUser, error: fetchError } = await getUserByTelegramId(
        telegramUser.id.toString()
    );

    // If user exists, return them
    if (existingUser) {
        return { data: existingUser, error: null };
    }

    // If error is not "not found", return the error
    if (fetchError && fetchError.code !== 'PGRST116') {
        return { data: null, error: fetchError };
    }

    // User doesn't exist, create them
    const newUser = {
        telegram_id: telegramUser.id.toString(),
        username: telegramUser.username || null,
        first_name: telegramUser.first_name || 'Player',
        photo_url: telegramUser.photo_url || null,
    };

    return await createUser(newUser);
}

/**
 * Get a match by its ID.
 * @param {string} matchId - UUID of the match
 */
async function getMatchById(matchId) {
    const { data, error } = await supabaseClient
        .from('matches')
        .select(`
            *,
            player_x:user_profiles!matches_player_x_fkey(first_name, username, photo_url),
            player_o:user_profiles!matches_player_o_fkey(first_name, username, photo_url)
        `)
        .eq('id', matchId)
        .single();

    if (error) {
        console.error('Error fetching match:', error);
    }

    return { data, error };
}

/**
 * Update a match's state.
 * @param {string} matchId - UUID of the match
 * @param {Object} updates - Fields to update
 */
async function updateMatch(matchId, updates) {
    const { data, error } = await supabaseClient
        .from('matches')
        .update(updates)
        .eq('id', matchId)
        .select()
        .single();

    if (error) {
        console.error('Error updating match:', error);
    }

    return { data, error };
}

/**
 * Record a move in the moves table.
 * @param {Object} moveData - Move data: { match_id, player_id, position }
 */
async function recordMove(moveData) {
    const { data, error } = await supabaseClient
        .from('moves')
        .insert([moveData])
        .select()
        .single();

    if (error) {
        console.error('Error recording move:', error);
    }

    return { data, error };
}

/**
 * Get all moves for a match.
 * @param {string} matchId - UUID of the match
 */
async function getMatchMoves(matchId) {
    const { data, error } = await supabaseClient
        .from('moves')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching moves:', error);
    }

    return { data, error };
}

/**
 * Join the waiting queue.
 * @param {string} userId - UUID of the user
 */
async function joinWaitingQueue(userId) {
    const { data, error } = await supabaseClient
        .from('waiting_queue')
        .insert([{ user_id: userId }])
        .select()
        .single();

    if (error) {
        console.error('Error joining queue:', error);
    }

    return { data, error };
}

/**
 * Leave the waiting queue.
 * @param {string} userId - UUID of the user
 */
async function leaveWaitingQueue(userId) {
    const { error } = await supabaseClient
        .from('waiting_queue')
        .delete()
        .eq('user_id', userId);

    if (error) {
        console.error('Error leaving queue:', error);
    }

    return { error };
}

/**
 * Check if someone else is in the waiting queue.
 * Returns the oldest waiting user (FIFO queue).
 */
async function findOpponentInQueue(excludeUserId) {
    const { data, error } = await supabaseClient
        .from('waiting_queue')
        .select(`
            *,
            user:users!waiting_queue_user_id_fkey(id, telegram_id, username, first_name, photo_url)
        `)
        .neq('user_id', excludeUserId)
        .order('joined_at', { ascending: true })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Error finding opponent:', error);
    }

    return { data, error };
}

/**
 * Check if a user is already in the queue.
 * @param {string} userId - UUID of the user
 */
async function isUserInQueue(userId) {
    const { data, error } = await supabaseClient
        .from('waiting_queue')
        .select('id')
        .eq('user_id', userId)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Error checking queue:', error);
    }

    return { inQueue: !!data, error };
}

/**
 * Create a new match between two players.
 * Randomly assigns X and O.
 * @param {string} player1Id - First player UUID
 * @param {string} player2Id - Second player UUID
 */
async function createMatch(player1Id, player2Id) {
    // Randomly decide who plays X and who plays O
    const coinFlip = Math.random() < 0.5;
    const playerX = coinFlip ? player1Id : player2Id;
    const playerO = coinFlip ? player2Id : player1Id;

    const { data, error } = await supabaseClient
        .from('matches')
        .insert([{
            player_x: playerX,
            player_o: playerO,
            board_state: '---------', // Empty 9-character board
            current_turn: 'X',      // X always goes first
            status: 'active',
        }])
        .select()
        .single();

    if (error) {
        console.error('Error creating match:', error);
    }

    return { data, error };
}

/**
 * Get user's game statistics.
 * @param {string} telegramId - Telegram ID of the user
 */
async function getUserStats(telegramId) {
    // Count games as player X
    const { count: xGames, error: xError } = await supabaseClient
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('player_x', telegramId)
        .eq('status', 'completed');

    // Count games as player O
    const { count: oGames, error: oError } = await supabaseClient
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('player_o', telegramId)
        .eq('status', 'completed');

    // Count wins
    const { count: wins, error: wError } = await supabaseClient
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('winner', telegramId)
        .eq('status', 'completed');

    if (xError || oError || wError) {
        console.error('Error fetching stats:', xError || oError || wError);
    }

    const totalGames = (xGames || 0) + (oGames || 0);

    return {
        totalGames,
        wins: wins || 0,
        draws: totalGames - (wins || 0) - Math.max(0, totalGames - (wins || 0)), // Approximate
    };
}
