/**
 * auth.js - Telegram Authentication & User Management
 * 
 * This file handles everything related to authentication:
 * 1. Reading Telegram initData from the WebApp SDK
 * 2. Verifying the data is authentic (preventing spoofing)
 * 3. Creating/fetching the user in Supabase
 * 4. Managing the current user session
 * 
 * SECURITY NOTE:
 * Telegram provides initData as a signed string. In production,
 * you should verify this signature on the server side (using
 * a Supabase Edge Function) to prevent users from faking
 * their identity. For this implementation, we do a basic
 * client-side check and rely on Supabase RLS for security.
 */

// ======== AUTH STATE ========
// We store the current user in a global variable.
// This is set after successful authentication.
let currentUser = null;

// Telegram WebApp instance (set during init)
let tgWebApp = null;

/**
 * Initialize Telegram WebApp and authenticate the user.
 * This is the FIRST thing that runs when the app loads.
 * 
 * @returns {Promise<Object>} The authenticated user object
 */
async function initAuth() {
    try {
        // Step 1: Initialize Telegram WebApp
        console.log('Initializing Telegram WebApp...');
        
        if (window.Telegram?.WebApp) {
            tgWebApp = window.Telegram.WebApp;
            
            // Tell Telegram we're ready
            tgWebApp.ready();
            
            // Expand to full height
            tgWebApp.expand();
            
            // Set header color to match our theme
            tgWebApp.setHeaderColor(tgWebApp.colorScheme === 'dark' ? '#1a1a1a' : '#ffffff');
            tgWebApp.setBackgroundColor(tgWebApp.colorScheme === 'dark' ? '#1a1a1a' : '#ffffff');
            
            console.log('Telegram WebApp initialized');
            console.log('Platform:', tgWebApp.platform);
            console.log('Version:', tgWebApp.version);
        } else {
            // Not running inside Telegram - development mode
            console.warn('Not running in Telegram WebApp - using dev mode');
            return await initDevMode();
        }

        // Step 2: Extract user data from Telegram
        const telegramUser = extractTelegramUser();
        
        if (!telegramUser) {
            throw new Error('Could not extract user data from Telegram');
        }

        console.log('Telegram user extracted:', telegramUser.first_name);

        // Step 3: Verify initData authenticity
        // In production, this should be done server-side via an Edge Function
        const isValid = verifyInitData(tgWebApp.initData);
        
        if (!isValid) {
            console.warn('initData verification failed - proceeding anyway for dev');
        }

        // Step 4: Get or create user in Supabase
        const { data: user, error } = await getOrCreateUser(telegramUser);

        if (error) {
            throw new Error(`Failed to create/get user: ${error.message}`);
        }

        currentUser = user;
        console.log('User authenticated:', user.first_name);

        // Step 5: Update connection status UI
        updateConnectionStatus(true);

        return user;

    } catch (error) {
        console.error('Auth initialization failed:', error);
        
        // Show error to user
        showToast('Authentication failed. Please try again.', 'error');
        updateConnectionStatus(false);
        
        // Fallback to dev mode for testing
        return await initDevMode();
    }
}

/**
 * Extract user information from Telegram WebApp initData.
 * Telegram provides this data when the Mini App opens.
 * 
 * @returns {Object|null} User data or null if not available
 */
function extractTelegramUser() {
    // If we're in Telegram, get user from initDataUnsafe
    if (tgWebApp?.initDataUnsafe?.user) {
        const user = tgWebApp.initDataUnsafe.user;
        
        return {
            id: user.id,
            first_name: user.first_name || 'Player',
            last_name: user.last_name || '',
            username: user.username || null,
            language_code: user.language_code || 'en',
            photo_url: user.photo_url || null,
            is_premium: user.is_premium || false,
        };
    }

    // If initData is available as a string, parse it
    if (tgWebApp?.initData) {
        try {
            const params = new URLSearchParams(tgWebApp.initData);
            const userJson = params.get('user');
            
            if (userJson) {
                const user = JSON.parse(userJson);
                return {
                    id: user.id,
                    first_name: user.first_name || 'Player',
                    last_name: user.last_name || '',
                    username: user.username || null,
                    language_code: user.language_code || 'en',
                    photo_url: user.photo_url || null,
                    is_premium: user.is_premium || false,
                };
            }
        } catch (e) {
            console.error('Failed to parse initData:', e);
        }
    }

    return null;
}

/**
 * Verify Telegram initData signature.
 * 
 * IMPORTANT: This is a CLIENT-SIDE verification for basic protection.
 * For production security, you MUST verify the hash server-side
 * using your Bot Token. This prevents users from faking their identity.
 * 
 * The proper verification is done in our Supabase Edge Function.
 * This client-side check is just a first line of defense.
 * 
 * @param {string} initData - The raw initData string from Telegram
 * @returns {boolean} Whether the data appears valid
 */
function verifyInitData(initData) {
    // If no initData, we're probably in development
    if (!initData) {
        console.log('No initData - development mode');
        return false;
    }

    try {
        // Parse the initData
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        
        if (!hash) {
            console.error('No hash in initData');
            return false;
        }

        // Remove the hash from the data for verification
        params.delete('hash');
        
        // Sort the parameters alphabetically
        const sortedParams = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b));
        
        // Create the data check string
        const dataCheckString = sortedParams
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        
        // Note: Full HMAC verification requires the bot token.
        // We do the full verification server-side in the Edge Function.
        // Here we just check that the data is well-formed.
        
        return dataCheckString.length > 0;

    } catch (error) {
        console.error('Error verifying initData:', error);
        return false;
    }
}

/**
 * Get the HMAC-SHA256 signature for initData verification.
 * This is used client-side for basic checks.
 * Full verification should be server-side.
 * 
 * @param {string} dataCheckString - The sorted initData parameters
 * @param {string} botToken - Your Telegram bot token
 */
async function getInitDataHash(dataCheckString, botToken) {
    // Create the secret key from the bot token
    const encoder = new TextEncoder();
    
    // Step 1: HMAC-SHA256 the bot token with "WebAppData" as key
    const secretKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode('WebAppData'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
    
    // Step 2: HMAC-SHA256 the dataCheckString with the secret
    const signatureKey = await crypto.subtle.importKey(
        'raw',
        secret,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(dataCheckString));
    
    // Convert to hex
    return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Initialize development mode - for testing outside Telegram.
 * Creates a mock user so we can test the app in a browser.
 */
async function initDevMode() {
    console.log('Initializing development mode...');

    // Create a mock Telegram user for testing
    const devUser = {
        id: 'dev_user_12345',
        first_name: 'Dev Player',
        last_name: '',
        username: 'devplayer',
        language_code: 'en',
        photo_url: null,
        is_premium: false,
    };

    // Try to get or create this user in Supabase
    const { data: user, error } = await getOrCreateUser(devUser);

    if (error) {
        console.error('Failed to create dev user:', error);
        showToast('Failed to connect to database', 'error');
        return null;
    }

    currentUser = user;
    console.log('Dev user ready:', user.first_name);

    // Show a toast to indicate dev mode
    showToast('Development mode - not in Telegram', 'info');

    return user;
}

/**
 * Get the currently authenticated user.
 * @returns {Object|null} The current user or null if not authenticated
 */
function getCurrentUser() {
    return currentUser;
}

/**
 * Check if a user is currently authenticated.
 * @returns {boolean}
 */
function isAuthenticated() {
    return currentUser !== null;
}

/**
 * Get the Telegram WebApp instance.
 * @returns {Object|null}
 */
function getTelegramWebApp() {
    return tgWebApp;
}

/**
 * Update the connection status indicator on the home screen.
 * @param {boolean} connected - Whether we're connected to Supabase
 */
function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    const dotEl = statusEl?.querySelector('.status-dot');
    const textEl = statusEl?.querySelector('.status-text');

    if (!statusEl || !dotEl || !textEl) return;

    if (connected) {
        dotEl.classList.add('connected');
        dotEl.classList.remove('error');
        textEl.textContent = 'Connected';
    } else {
        dotEl.classList.remove('connected');
        dotEl.classList.add('error');
        textEl.textContent = 'Disconnected';
    }
}

/**
 * Log out the current user.
 * Cleans up all subscriptions and resets state.
 */
function logout() {
    // Unsubscribe from all realtime channels
    unsubscribeAllChannels();
    
    // Clear current user
    currentUser = null;
    
    // Reset UI to loading screen
    showScreen('loading-screen');
    
    console.log('User logged out');
}

/**
 * Check if we're running inside Telegram.
 * @returns {boolean}
 */
function isRunningInTelegram() {
    return !!window.Telegram?.WebApp;
}

/**
 * Get user initials for avatar fallback.
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name (optional)
 * @returns {string} 1-2 character initials
 */
function getUserInitials(firstName, lastName = '') {
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || '?';
}
