/**
 * matchmaking.js - Matchmaking & Queue System
 * 
 * This file handles the entire matchmaking flow:
 * 1. Join the waiting queue
 * 2. Look for opponents already in the queue
 * 3. Create a match when two players are found
 * 4. Handle the 30-second timeout (offer AI opponent)
 * 5. Cancel matchmaking
 * 
 * We use Supabase for the queue storage and Realtime for
 * instant match notifications.
 */

// ======== MATCHMAKING STATE ========
let matchmakingState = {
    isSearching: false,      // Are we currently looking for a match?
    startTime: null,         // When did we start searching?
    timerInterval: null,     // Reference to the timer interval
    waitTime: 0,             // How many seconds have we waited
    queueEntryId: null,      // Our entry in the waiting_queue table
    matchSubscription: null, // Realtime subscription for match updates
};

// Constants
const MAX_WAIT_TIME = 30; // Seconds before offering AI opponent

/**
 * Start the matchmaking process.
 * This is called when the user taps "Play Online".
 * 
 * @returns {Promise<Object>} The created match, or null if queued
 */
async function startMatchmaking() {
    // Don't start if already searching
    if (matchmakingState.isSearching) {
        console.log('Already matchmaking');
        return null;
    }

    const user = getCurrentUser();
    if (!user) {
        showToast('Please log in first', 'error');
        return null;
    }

    console.log('Starting matchmaking...');
    matchmakingState.isSearching = true;
    matchmakingState.startTime = Date.now();
    matchmakingState.waitTime = 0;

    // Show matchmaking screen
    showScreen('matchmaking-screen');

    // Reset the AI option (hide it initially)
    document.getElementById('ai-option')?.classList.add('hidden');

    // Start the timer display
    startMatchmakingTimer();

    try {
        // Step 1: Check if someone is already waiting
        const { data: opponent, error: findError } = await findOpponentInQueue(user.id);

        if (findError && findError.code !== 'PGRST116') {
            console.error('Error finding opponent:', findError);
            showToast('Error finding opponent', 'error');
            stopMatchmaking();
            return null;
        }

        if (opponent) {
            // Found an opponent! Create a match immediately.
            console.log('Found opponent:', opponent.user?.first_name);

            // Remove opponent from queue first
            await leaveWaitingQueue(opponent.user_id);

            // Create the match
            const { data: match, error: matchError } = await createMatch(user.id, opponent.user_id);

            if (matchError) {
                console.error('Error creating match:', matchError);
                showToast('Error creating match', 'error');
                stopMatchmaking();
                return null;
            }

            console.log('Match created:', match.id);

            // Stop matchmaking and go to the game
            stopMatchmaking();
            await startGame(match.id, false); // false = not AI opponent

            return match;
        }

        // Step 2: No opponent found, join the queue
        console.log('No opponent found, joining queue...');

        // Check if already in queue (safety check)
        const { inQueue } = await isUserInQueue(user.id);
        
        if (!inQueue) {
            const { data: queueEntry, error: queueError } = await joinWaitingQueue(user.id);

            if (queueError) {
                console.error('Error joining queue:', queueError);
                showToast('Error joining queue', 'error');
                stopMatchmaking();
                return null;
            }

            matchmakingState.queueEntryId = queueEntry?.id;
        }

        // Step 3: Set up realtime listener for match creation
        // We listen for matches where we're either player X or player O
        setupMatchListener(user.id);

        // Step 4: Start the 30-second timeout
        startMatchmakingTimeout();

        showToast('Searching for opponent...', 'info');

    } catch (error) {
        console.error('Matchmaking error:', error);
        showToast('Something went wrong', 'error');
        stopMatchmaking();
    }

    return null;
}

/**
 * Set up a realtime listener to detect when a match is created for us.
 * Another player might pick us from the queue.
 * 
 * @param {string} userId - Our user ID
 */
function setupMatchListener(userId) {
    // Subscribe to matches where we're player_x
    subscribeToChannel(
        'match-player-x',
        'matches',
        'INSERT',
        async (payload) => {
            const match = payload.new;
            if (match.player_x === userId && match.status === 'active') {
                console.log('Match created (as player X):', match.id);
                stopMatchmaking();
                await startGame(match.id, false);
            }
        }
    );

    // Subscribe to matches where we're player_o
    subscribeToChannel(
        'match-player-o',
        'matches',
        'INSERT',
        async (payload) => {
            const match = payload.new;
            if (match.player_o === userId && match.status === 'active') {
                console.log('Match created (as player O):', match.id);
                stopMatchmaking();
                await startGame(match.id, false);
            }
        }
    );
}

/**
 * Start the visual timer that counts up during matchmaking.
 */
function startMatchmakingTimer() {
    const timerEl = document.getElementById('wait-timer');
    const progressEl = document.getElementById('wait-progress');
    const secondsEl = document.getElementById('wait-seconds');

    // Update every second
    matchmakingState.timerInterval = setInterval(() => {
        matchmakingState.waitTime++;

        // Format as MM:SS
        const minutes = Math.floor(matchmakingState.waitTime / 60);
        const seconds = matchmakingState.waitTime % 60;
        const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        if (timerEl) timerEl.textContent = formatted;
        if (secondsEl) secondsEl.textContent = matchmakingState.waitTime;

        // Update progress bar (fills over 30 seconds)
        if (progressEl) {
            const progress = Math.min((matchmakingState.waitTime / MAX_WAIT_TIME) * 100, 100);
            progressEl.style.width = `${progress}%`;
        }
    }, 1000);
}

/**
 * Start the 30-second timeout.
 * After 30 seconds, we show the option to play against AI.
 */
function startMatchmakingTimeout() {
    setTimeout(() => {
        // Only show AI option if still searching
        if (matchmakingState.isSearching) {
            console.log('30 seconds elapsed, showing AI option');
            showAIOption();
        }
    }, MAX_WAIT_TIME * 1000);
}

/**
 * Show the "Play vs AI" option after timeout.
 */
function showAIOption() {
    const aiOptionEl = document.getElementById('ai-option');
    if (aiOptionEl) {
        aiOptionEl.classList.remove('hidden');
    }
}

/**
 * Stop matchmaking and clean up.
 * Called when: match found, user cancels, or error occurs.
 */
async function stopMatchmaking() {
    console.log('Stopping matchmaking...');

    // Clear timer
    if (matchmakingState.timerInterval) {
        clearInterval(matchmakingState.timerInterval);
        matchmakingState.timerInterval = null;
    }

    // Remove from waiting queue
    const user = getCurrentUser();
    if (user) {
        await leaveWaitingQueue(user.id);
    }

    // Unsubscribe from match listeners
    unsubscribeFromChannel('match-player-x');
    unsubscribeFromChannel('match-player-o');

    // Reset state
    matchmakingState = {
        isSearching: false,
        startTime: null,
        timerInterval: null,
        waitTime: 0,
        queueEntryId: null,
        matchSubscription: null,
    };
}

/**
 * Cancel matchmaking (user tapped Cancel button).
 */
async function cancelMatchmaking() {
    await stopMatchmaking();
    showScreen('home-screen');
    showToast('Matchmaking cancelled', 'info');
}

/**
 * Accept the AI opponent option after timeout.
 */
async function acceptAIOpponent() {
    await stopMatchmaking();
    startAIGame();
}

/**
 * Continue waiting for a human opponent.
 */
async function continueWaiting() {
    // Hide the AI option
    document.getElementById('ai-option')?.classList.add('hidden');
    
    // Reset the progress bar (it will fill again)
    const progressEl = document.getElementById('wait-progress');
    if (progressEl) {
        progressEl.style.transition = 'none';
        progressEl.style.width = '0%';
        // Force reflow
        progressEl.offsetHeight;
        progressEl.style.transition = 'width 1s linear';
    }

    // Start another 30-second countdown
    startMatchmakingTimeout();

    showToast('Continuing to search...', 'info');
}

/**
 * Start a game against the AI opponent.
 * This is called from the home screen (direct AI play) or from matchmaking.
 */
async function startAIGame() {
    const user = getCurrentUser();
    if (!user) {
        showToast('Please log in first', 'error');
        return;
    }

    console.log('Starting AI game...');

    try {
        // Create a single-player match against AI
        // We use a special AI user ID as the opponent
        const { data: match, error } = await supabaseClient
            .from('matches')
            .insert([{
                player_x: user.id,
                player_o: 'ai_opponent', // Special ID for AI
                board_state: '---------',
                current_turn: 'X',
                status: 'active',
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating AI match:', error);
            showToast('Error starting AI game', 'error');
            return;
        }

        await startGame(match.id, true); // true = AI opponent

    } catch (error) {
        console.error('Error starting AI game:', error);
        showToast('Something went wrong', 'error');
    }
}
