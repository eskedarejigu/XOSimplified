/**
 * app.js - Main Application Entry Point & UI Controller
 * 
 * This is the main file that runs when the app starts.
 * It orchestrates everything:
 * 1. Initialize Telegram WebApp
 * 2. Authenticate the user
 * 3. Load user stats
 * 4. Set up all event listeners
 * 5. Handle screen navigation
 * 
 * Think of this as the "director" that tells all the other
 * files what to do and when.
 */

// ======== APP STATE ========
const appState = {
    initialized: false,    // Has the app finished initializing?
    currentScreen: '',     // Which screen is currently visible
};

// ======== SCREEN DEFINITIONS ========
// List of all screen IDs for navigation
const SCREENS = [
    'loading-screen',
    'home-screen',
    'matchmaking-screen',
    'game-screen',
    'result-screen',
];

/**
 * MAIN ENTRY POINT
 * This function runs when the page finishes loading.
 * It's the first thing that executes.
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('========================================');
    console.log('  XO Arena - Telegram Mini App');
    console.log('  Tic-Tac-Toe with Online Multiplayer');
    console.log('========================================');

    // Show loading screen immediately
    showScreen('loading-screen');

    try {
        // Step 1: Check Supabase configuration
        if (!isSupabaseConfigured()) {
            console.error('Supabase is not configured!');
            showToast('Please configure Supabase credentials', 'error');
            // Still show home screen so user sees something
            showScreen('home-screen');
            return;
        }

        // Step 2: Authenticate user via Telegram
        const user = await initAuth();

        if (!user) {
            console.error('Authentication failed');
            showToast('Failed to authenticate', 'error');
            return;
        }

        // Step 3: Update home screen with user info
        updateHomeScreen(user);

        // Step 4: Load user stats
        await loadUserStats(user);

        // Step 5: Set up all button click handlers
        setupEventListeners();

        // Step 6: Show the home screen
        showScreen('home-screen');

        appState.initialized = true;
        console.log('XO Arena initialized successfully!');

    } catch (error) {
        console.error('App initialization failed:', error);
        showToast('Failed to initialize app', 'error');
    }
});

/**
 * Switch between screens.
 * Hides all screens and shows only the requested one.
 * 
 * @param {string} screenId - ID of the screen to show
 */
function showScreen(screenId) {
    // Hide all screens
    SCREENS.forEach((id) => {
        const screen = document.getElementById(id);
        if (screen) {
            screen.classList.remove('active');
        }
    });

    // Show the requested screen
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        appState.currentScreen = screenId;
        console.log(`Switched to screen: ${screenId}`);
    } else {
        console.error(`Screen not found: ${screenId}`);
    }
}

/**
 * Update the home screen with user information.
 * Fills in the profile card with the user's Telegram data.
 * 
 * @param {Object} user - User data from Supabase
 */
function updateHomeScreen(user) {
    if (!user) return;

    // Update name
    const nameEl = document.getElementById('user-name');
    if (nameEl) {
        nameEl.textContent = user.first_name || 'Player';
    }

    // Update username
    const usernameEl = document.getElementById('user-username');
    if (usernameEl) {
        usernameEl.textContent = user.username ? `@${user.username}` : '';
    }

    // Update avatar (photo or initials fallback)
    const photoEl = document.getElementById('user-photo');
    const initialsEl = document.getElementById('user-initials');

    if (user.photo_url) {
        // User has a profile photo
        if (photoEl) {
            photoEl.src = user.photo_url;
            photoEl.style.display = 'block';
        }
        if (initialsEl) {
            initialsEl.style.display = 'none';
        }
    } else {
        // No photo - show initials
        if (photoEl) {
            photoEl.style.display = 'none';
        }
        if (initialsEl) {
            initialsEl.style.display = 'flex';
            initialsEl.textContent = getUserInitials(
                user.first_name,
                user.last_name || ''
            );
        }
    }
}

/**
 * Load and display user statistics.
 * Fetches total games, wins, and draws from Supabase.
 * 
 * @param {Object} user - User data
 */
async function loadUserStats(user) {
    try {
        // For now, we'll use a simple count from the matches table
        // In production, you might want to cache this in the users table
        
        // Count matches where user is player X
        const { count: xCount } = await getSupabase()
            .from('matches')
            .select('*', { count: 'exact', head: true })
            .eq('player_x', user.id)
            .eq('status', 'completed');

        // Count matches where user is player O
        const { count: oCount } = await getSupabase()
            .from('matches')
            .select('*', { count: 'exact', head: true })
            .eq('player_o', user.id)
            .eq('status', 'completed');

        // Count wins
        const { count: winCount } = await getSupabase()
            .from('matches')
            .select('*', { count: 'exact', head: true })
            .eq('winner', user.id)
            .eq('status', 'completed');

        const totalGames = (xCount || 0) + (oCount || 0);
        const wins = winCount || 0;
        const draws = Math.max(0, totalGames - wins - Math.floor((totalGames - wins) / 2));

        // Update stats display
        const gamesEl = document.getElementById('games-played');
        const winsEl = document.getElementById('games-won');
        const drawsEl = document.getElementById('games-drawn');

        if (gamesEl) gamesEl.textContent = totalGames;
        if (winsEl) winsEl.textContent = wins;
        if (drawsEl) drawsEl.textContent = draws;

    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

/**
 * Set up all button click event listeners.
 * This connects the UI buttons to their handler functions.
 */
function setupEventListeners() {
    // ======== HOME SCREEN ========

    // Play Online button
    const playOnlineBtn = document.getElementById('play-online-btn');
    if (playOnlineBtn) {
        playOnlineBtn.addEventListener('click', async () => {
            console.log('Play Online clicked');
            
            // Haptic feedback
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
            }

            // Check if authenticated
            if (!isAuthenticated()) {
                showToast('Please wait, still connecting...', 'info');
                return;
            }

            // Start matchmaking
            await startMatchmaking();
        });
    }

    // Play vs AI button (from home screen)
    const playAIBtn = document.getElementById('play-ai-btn');
    if (playAIBtn) {
        playAIBtn.addEventListener('click', async () => {
            console.log('Play vs AI clicked');
            
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
            }

            if (!isAuthenticated()) {
                showToast('Please wait, still connecting...', 'info');
                return;
            }

            await startAIGame();
        });
    }

    // ======== MATCHMAKING SCREEN ========

    // Cancel matchmaking button
    const cancelBtn = document.getElementById('cancel-matchmaking-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
            console.log('Cancel matchmaking clicked');
            await cancelMatchmaking();
        });
    }

    // Play vs AI button (from matchmaking timeout)
    const matchmakingAIBtn = document.getElementById('matchmaking-play-ai-btn');
    if (matchmakingAIBtn) {
        matchmakingAIBtn.addEventListener('click', async () => {
            console.log('Play vs AI (from matchmaking) clicked');
            await acceptAIOpponent();
        });
    }

    // Continue waiting button (from matchmaking timeout)
    const continueWaitingBtn = document.getElementById('continue-waiting-btn');
    if (continueWaitingBtn) {
        continueWaitingBtn.addEventListener('click', async () => {
            console.log('Continue waiting clicked');
            await continueWaiting();
        });
    }

    // ======== GAME SCREEN ========

    // Leave match button
    const leaveBtn = document.getElementById('leave-match-btn');
    if (leaveBtn) {
        leaveBtn.addEventListener('click', () => {
            console.log('Leave match clicked');
            leaveMatch();
        });
    }

    // ======== RESULT SCREEN ========

    // Play again button
    const playAgainBtn = document.getElementById('play-again-btn');
    if (playAgainBtn) {
        playAgainBtn.addEventListener('click', async () => {
            console.log('Play again clicked');
            
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
            }

            await playAgain();
        });
    }

    // Back to home button
    const backHomeBtn = document.getElementById('back-home-btn');
    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', () => {
            console.log('Back to home clicked');
            goHome();
        });
    }

    console.log('All event listeners set up');
}

/**
 * Show a toast notification.
 * Creates a temporary message that appears at the top of the screen.
 * 
 * @param {string} message - The message to display
 * @param {string} type - 'success', 'error', or 'info'
 * @param {number} duration - How long to show (ms), default 3000
 */
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Add to container
    container.appendChild(toast);

    // Remove after duration
    setTimeout(() => {
        toast.remove();
    }, duration);
}

/**
 * Handle back button (Telegram WebApp back event).
 * When the user presses the back button in Telegram,
 * we should navigate to the previous screen.
 */
function handleBackButton() {
    const screenMap = {
        'home-screen': null,           // Already at home, can't go back
        'matchmaking-screen': 'home-screen',
        'game-screen': null,           // Show confirmation in leaveMatch
        'result-screen': 'home-screen',
    };

    const previousScreen = screenMap[appState.currentScreen];

    if (previousScreen) {
        showScreen(previousScreen);
    }
}

/**
 * Handle app visibility change.
 * When the user switches away from the app and comes back,
 * we may need to refresh data.
 */
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log('App became visible');
        
        // If we're in a game, refresh the match state
        if (appState.currentScreen === 'game-screen' && !getGameState().gameOver) {
            refreshGameState();
        }
    }
});

/**
 * Refresh the current game state from Supabase.
 * Useful when returning to the app after backgrounding.
 */
async function refreshGameState() {
    const game = getGameState();
    if (!game.matchId) return;

    try {
        const { data: match } = await getMatchById(game.matchId);
        
        if (match && match.status === 'completed') {
            // Game ended while we were away
            handleGameEnd(match);
        }
    } catch (error) {
        console.error('Error refreshing game state:', error);
    }
}

/**
 * Handle window resize.
 * Ensures the board stays responsive on different screen sizes.
 */
window.addEventListener('resize', () => {
    // The CSS handles most responsive behavior,
    // but we can add JS-based adjustments here if needed
});

// ======== UTILITY FUNCTIONS ========

/**
 * Format a number with leading zero if needed.
 * @param {number} num - Number to format
 * @returns {string} Formatted number (e.g., "05")
 */
function padZero(num) {
    return num.toString().padStart(2, '0');
}

/**
 * Deep clone an object.
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Debounce function calls.
 * Prevents a function from being called too frequently.
 * 
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ======== ERROR HANDLING ========

/**
 * Global error handler.
 * Catches unhandled errors and shows a user-friendly message.
 */
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    showToast('Something went wrong. Please try again.', 'error');
});

/**
 * Handle unhandled promise rejections.
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showToast('Network error. Please check your connection.', 'error');
});

console.log('app.js loaded - waiting for DOMContentLoaded');
