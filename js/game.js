/**
 * game.js - Core Game Logic, Move Handling & Realtime Sync
 * 
 * This file manages the entire gameplay experience:
 * 1. Initialize the game board
 * 2. Handle player moves (click on cells)
 * 3. Validate moves (server-side via Supabase)
 * 4. Detect wins and draws
 * 5. Sync state in real-time between players using Supabase Realtime
 * 6. Handle AI moves when playing against the computer
 * 7. Show results and clean up after the match
 */

// ======== GAME STATE ========
let gameState = {
    matchId: null,         // Current match UUID
    isAI: false,           // Is this an AI opponent?
    board: '---------',    // 9-character board string
    mySymbol: null,        // 'X' or 'O'
    currentTurn: 'X',      // Whose turn is it
    status: 'active',      // Match status
    opponent: null,        // Opponent user data
    matchStartTime: null,  // When the match started
    moveCount: 0,          // Total moves made
    isMyTurn: false,       // Is it currently my turn?
    gameOver: false,       // Is the game finished?
};

// ======== WINNING LINES ========
// All 8 possible ways to win in Tic-Tac-Toe
const WINNING_LINES = [
    [0, 1, 2], // Top row
    [3, 4, 5], // Middle row
    [6, 7, 8], // Bottom row
    [0, 3, 6], // Left column
    [1, 4, 7], // Middle column
    [2, 5, 8], // Right column
    [0, 4, 8], // Diagonal (top-left to bottom-right)
    [2, 4, 6], // Diagonal (top-right to bottom-left)
];

/**
 * Start a new game.
 * This is called after matchmaking finds an opponent or for AI games.
 * 
 * @param {string} matchId - The match UUID
 * @param {boolean} isAI - Whether opponent is AI
 */
async function startGame(matchId, isAI = false) {
    console.log(`Starting game: match=${matchId}, AI=${isAI}`);

    // Reset game state
    gameState = {
        matchId: matchId,
        isAI: isAI,
        board: '---------',
        mySymbol: null,
        currentTurn: 'X',
        status: 'active',
        opponent: null,
        matchStartTime: Date.now(),
        moveCount: 0,
        isMyTurn: false,
        gameOver: false,
    };

    // Fetch full match details
    const { data: match, error } = await getMatchById(matchId);

    if (error || !match) {
        console.error('Failed to load match:', error);
        showToast('Error loading match', 'error');
        showScreen('home-screen');
        return;
    }

    // Determine my symbol based on match data
    const user = getCurrentUser();
    
    if (match.player_x === user.id) {
        gameState.mySymbol = 'X';
    } else if (match.player_o === user.id) {
        gameState.mySymbol = 'O';
    } else if (isAI && match.player_o === 'ai_opponent') {
        gameState.mySymbol = 'X'; // Human is always X against AI
    } else {
        console.error('User is not a player in this match');
        showToast('Error: not a player in this match', 'error');
        showScreen('home-screen');
        return;
    }

    // Set opponent info
    if (isAI) {
        gameState.opponent = {
            first_name: 'AI Opponent',
            username: 'bot',
            photo_url: null,
        };
    } else {
        // Get opponent data based on which player we are
        if (gameState.mySymbol === 'X') {
            gameState.opponent = match.player_o;
        } else {
            gameState.opponent = match.player_x;
        }
    }

    // Update board state from match
    gameState.board = match.board_state || '---------';
    gameState.currentTurn = match.current_turn || 'X';
    gameState.status = match.status || 'active';

    // Check if it's my turn
    gameState.isMyTurn = gameState.currentTurn === gameState.mySymbol;

    // Show the game screen
    showScreen('game-screen');

    // Update the UI
    updateGameUI();

    // Set up realtime subscription for match updates
    setupGameRealtimeSubscription(matchId);

    // If playing against AI and it's AI's turn, make AI move
    if (isAI && !gameState.isMyTurn && !gameState.gameOver) {
        setTimeout(makeAIMove, 800); // Small delay for realism
    }

    // If it's my turn, highlight the board
    updateBoardInteraction();
}

/**
 * Set up realtime subscription for the current match.
 * This listens for board state updates from the opponent.
 * 
 * @param {string} matchId - The match UUID
 */
function setupGameRealtimeSubscription(matchId) {
    // Listen for updates to this specific match
    subscribeToChannel(
        `match-${matchId}`,
        'matches',
        'UPDATE',
        (payload) => {
            const updatedMatch = payload.new;
            console.log('Match updated via realtime:', updatedMatch);

            // Update local state
            gameState.board = updatedMatch.board_state;
            gameState.currentTurn = updatedMatch.current_turn;
            gameState.status = updatedMatch.status;

            // Check if it's my turn now
            gameState.isMyTurn = gameState.currentTurn === gameState.mySymbol;

            // Check if game is over
            if (updatedMatch.status === 'completed') {
                handleGameEnd(updatedMatch);
                return;
            }

            // Update the UI
            updateBoardUI();
            updateTurnIndicator();
            updateBoardInteraction();

            // If playing against AI and it's AI's turn
            if (gameState.isAI && !gameState.isMyTurn && !gameState.gameOver) {
                setTimeout(makeAIMove, 600);
            }
        },
        { column: 'id', value: matchId }
    );

    // Also listen for new moves (for move history)
    subscribeToChannel(
        `moves-${matchId}`,
        'moves',
        'INSERT',
        (payload) => {
            console.log('New move recorded:', payload.new);
            gameState.moveCount++;
        },
        { column: 'match_id', value: matchId }
    );
}

/**
 * Handle a cell click on the game board.
 * This is the main interaction point for the player.
 * 
 * @param {number} position - Cell index (0-8)
 */
async function handleCellClick(position) {
    // Validate that we can make a move
    if (!canMakeMove(position)) {
        return;
    }

    console.log(`Player clicked cell ${position}`);

    try {
        // Make the move
        await makeMove(position);

    } catch (error) {
        console.error('Error making move:', error);
        showToast('Error making move', 'error');
    }
}

/**
 * Check if the player can make a move at the given position.
 * All validation happens here before sending to server.
 * 
 * @param {number} position - Cell index (0-8)
 * @returns {boolean} Whether the move is allowed
 */
function canMakeMove(position) {
    // Game must be active
    if (gameState.gameOver || gameState.status !== 'active') {
        showToast('Game is over', 'info');
        return false;
    }

    // Must be my turn
    if (!gameState.isMyTurn) {
        showToast("Wait for your opponent's turn", 'info');
        return false;
    }

    // Position must be valid (0-8)
    if (position < 0 || position > 8) {
        return false;
    }

    // Cell must be empty
    if (gameState.board[position] !== '-') {
        showToast('Cell already taken', 'info');
        return false;
    }

    return true;
}

/**
 * Make a move on the board.
 * Updates the board state both locally and in Supabase.
 * 
 * @param {number} position - Cell index (0-8)
 */
async function makeMove(position) {
    const user = getCurrentUser();
    const matchId = gameState.matchId;
    const symbol = gameState.mySymbol;

    // Update local board immediately (optimistic update)
    const boardArray = gameState.board.split('');
    boardArray[position] = symbol;
    const newBoard = boardArray.join('');
    const newTurn = symbol === 'X' ? 'O' : 'X';

    // Update local state
    gameState.board = newBoard;
    gameState.currentTurn = newTurn;
    gameState.isMyTurn = false; // Just made our move
    gameState.moveCount++;

    // Update UI immediately
    updateBoardUI();
    updateTurnIndicator();
    updateBoardInteraction();

    // Check for win/draw locally
    const gameResult = checkGameResult(newBoard);
    
    if (gameResult.gameOver) {
        // Game ended - update match as completed
        await completeMatch(matchId, gameResult.winner, newBoard, newTurn);
        handleGameEnd({
            winner: gameResult.winner,
            board_state: newBoard,
        });
        return;
    }

    // Send move to Supabase
    // We do TWO operations: record the move + update the match
    
    // 1. Record the move in moves table
    await recordMove({
        match_id: matchId,
        player_id: user.id,
        position: position,
    });

    // 2. Update the match state
    await updateMatch(matchId, {
        board_state: newBoard,
        current_turn: newTurn,
    });

    // If playing against AI, trigger AI move
    if (gameState.isAI && !gameState.gameOver) {
        setTimeout(makeAIMove, 600);
    }
}

/**
 * Make the AI's move.
 * Called after the player makes their move.
 */
async function makeAIMove() {
    if (gameState.gameOver || gameState.status !== 'active') {
        return;
    }

    console.log('AI is thinking...');

    // Get the best move from the AI
    const aiPosition = getAIMove(gameState.board);

    // Update local board
    const boardArray = gameState.board.split('');
    boardArray[aiPosition] = AI_SYMBOL; // 'O'
    const newBoard = boardArray.join('');
    const newTurn = PLAYER_SYMBOL; // Back to player's turn ('X')

    // Update local state
    gameState.board = newBoard;
    gameState.currentTurn = newTurn;
    gameState.isMyTurn = true; // Now it's player's turn
    gameState.moveCount++;

    // Update UI
    updateBoardUI();
    updateTurnIndicator();
    updateBoardInteraction();

    // Check for win/draw
    const gameResult = checkGameResult(newBoard);

    if (gameResult.gameOver) {
        await completeMatch(gameState.matchId, gameResult.winner, newBoard, newTurn);
        handleGameEnd({
            winner: gameResult.winner,
            board_state: newBoard,
        });
        return;
    }

    // Record AI move in database
    await recordMove({
        match_id: gameState.matchId,
        player_id: 'ai_opponent',
        position: aiPosition,
    });

    // Update match state
    await updateMatch(gameState.matchId, {
        board_state: newBoard,
        current_turn: newTurn,
    });
}

/**
 * Check the game result for a given board state.
 * Returns whether the game is over and who won.
 * 
 * @param {string} board - 9-character board string
 * @returns {Object} { gameOver: boolean, winner: string|null, isDraw: boolean, winningLine: number[]|null }
 */
function checkGameResult(board) {
    // Check all winning lines
    for (const line of WINNING_LINES) {
        const [a, b, c] = line;
        const symbol = board[a];

        // If all three positions have the same non-empty symbol
        if (symbol !== '-' && symbol === board[b] && symbol === board[c]) {
            return {
                gameOver: true,
                winner: symbol,
                isDraw: false,
                winningLine: line,
            };
        }
    }

    // Check for draw (board is full with no winner)
    if (!board.includes('-')) {
        return {
            gameOver: true,
            winner: null,
            isDraw: true,
            winningLine: null,
        };
    }

    // Game is still ongoing
    return {
        gameOver: false,
        winner: null,
        isDraw: false,
        winningLine: null,
    };
}

/**
 * Complete a match by updating its status and winner.
 * 
 * @param {string} matchId - Match UUID
 * @param {string|null} winner - Winning symbol ('X', 'O') or null for draw
 * @param {string} boardState - Final board state
 * @param {string} currentTurn - Current turn symbol
 */
async function completeMatch(matchId, winner, boardState, currentTurn) {
    const user = getCurrentUser();

    // Determine the winner's user ID
    let winnerId = null;
    
    if (winner) {
        // Get the match to find player IDs
        const { data: match } = await getMatchById(matchId);
        if (match) {
            winnerId = winner === 'X' ? match.player_x : match.player_o;
        }
    }

    // Update the match as completed
    await updateMatch(matchId, {
        board_state: boardState,
        current_turn: currentTurn,
        status: 'completed',
        winner: winnerId,
    });

    // If user won, trigger haptic feedback
    if (winnerId === user.id && window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }
}

/**
 * Handle the end of the game.
 * Shows the result screen with appropriate messaging.
 * 
 * @param {Object} matchData - Match data from the database
 */
function handleGameEnd(matchData) {
    gameState.gameOver = true;
    gameState.status = 'completed';

    // Unsubscribe from game realtime channels
    unsubscribeFromChannel(`match-${gameState.matchId}`);
    unsubscribeFromChannel(`moves-${gameState.matchId}`);

    // Determine the result
    const user = getCurrentUser();
    let resultType = 'draw';
    let title = "It's a Draw!";
    let message = 'Good game! No winner this time.';
    let icon = '🤝';

    if (matchData.winner) {
        if (matchData.winner === user.id) {
            resultType = 'win';
            title = 'You Won!';
            message = 'Congratulations! Victory is yours!';
            icon = '🏆';
        } else {
            resultType = 'loss';
            title = 'You Lost!';
            message = 'Better luck next time!';
            icon = '😔';
        }
    }

    // Highlight winning line on the board
    const gameResult = checkGameResult(gameState.board);
    if (gameResult.winningLine) {
        highlightWinningCells(gameResult.winningLine);
    }

    // Show result after a short delay
    setTimeout(() => {
        showResultScreen(resultType, title, message, icon);
    }, 1500);
}

/**
 * Show the result screen with the appropriate content.
 */
function showResultScreen(resultType, title, message, icon) {
    // Update result screen content
    const iconEl = document.getElementById('result-icon');
    const titleEl = document.getElementById('result-title');
    const messageEl = document.getElementById('result-message');
    const symbolEl = document.getElementById('result-symbol');
    const movesEl = document.getElementById('result-moves');
    const durationEl = document.getElementById('result-duration');

    if (iconEl) iconEl.textContent = icon;
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (symbolEl) {
        symbolEl.textContent = gameState.mySymbol;
        symbolEl.className = `summary-value symbol-${gameState.mySymbol.toLowerCase()}`;
    }
    if (movesEl) movesEl.textContent = gameState.moveCount;

    // Calculate match duration
    const duration = Math.floor((Date.now() - gameState.matchStartTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    if (durationEl) durationEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Switch to result screen
    showScreen('result-screen');
}

/**
 * Leave the current match (abandon).
 * Called when the user taps "Leave Match".
 */
async function leaveMatch() {
    if (!gameState.matchId || gameState.gameOver) {
        showScreen('home-screen');
        return;
    }

    // Confirm before leaving
    if (!confirm('Are you sure you want to leave this match? You will forfeit.')) {
        return;
    }

    try {
        // Mark match as abandoned
        await updateMatch(gameState.matchId, {
            status: 'abandoned',
        });

        // Clean up subscriptions
        unsubscribeFromChannel(`match-${gameState.matchId}`);
        unsubscribeFromChannel(`moves-${gameState.matchId}`);

        // Reset game state
        resetGameState();

        showToast('You left the match', 'info');
        showScreen('home-screen');

    } catch (error) {
        console.error('Error leaving match:', error);
        showToast('Error leaving match', 'error');
    }
}

/**
 * Play again after a match ends.
 */
async function playAgain() {
    // Clean up the old match
    unsubscribeFromChannel(`match-${gameState.matchId}`);
    unsubscribeFromChannel(`moves-${gameState.matchId}`);

    resetGameState();

    // If it was an AI game, start a new AI game
    // Otherwise, go back to matchmaking
    if (gameState.isAI) {
        startAIGame();
    } else {
        startMatchmaking();
    }
}

/**
 * Go back to the home screen from the result screen.
 */
function goHome() {
    unsubscribeFromChannel(`match-${gameState.matchId}`);
    unsubscribeFromChannel(`moves-${gameState.matchId}`);
    resetGameState();
    showScreen('home-screen');
}

/**
 * Reset all game state to initial values.
 */
function resetGameState() {
    gameState = {
        matchId: null,
        isAI: false,
        board: '---------',
        mySymbol: null,
        currentTurn: 'X',
        status: 'active',
        opponent: null,
        matchStartTime: null,
        moveCount: 0,
        isMyTurn: false,
        gameOver: false,
    };
}

// ======== UI UPDATE FUNCTIONS ========

/**
 * Update the entire game UI (called when game starts or major state change).
 */
function updateGameUI() {
    updatePlayerCards();
    updateTurnIndicator();
    updateBoardUI();
    updateBoardInteraction();
    updateMatchStatus();
}

/**
 * Update the player cards in the game header.
 */
function updatePlayerCards() {
    const user = getCurrentUser();
    const opponent = gameState.opponent;

    // Update Player X card
    const playerXName = document.getElementById('player-x-name');
    const playerXCard = document.getElementById('player-x-card');
    
    if (gameState.mySymbol === 'X') {
        // I am player X
        if (playerXName) playerXName.textContent = 'You';
        updatePlayerAvatar('game-user-photo', 'game-user-initials', user);
    } else {
        // Opponent is player X
        if (playerXName) playerXName.textContent = opponent?.first_name || 'Opponent';
        updatePlayerAvatar('game-user-photo', 'game-user-initials', opponent);
    }

    // Update Player O card
    const playerOName = document.getElementById('player-o-name');
    const playerOCard = document.getElementById('player-o-card');

    if (gameState.mySymbol === 'O') {
        // I am player O
        if (playerOName) playerOName.textContent = 'You';
        updatePlayerAvatar('game-opponent-photo', 'game-opponent-initials', user);
    } else {
        // Opponent is player O
        if (playerOName) playerOName.textContent = opponent?.first_name || 'Opponent';
        updatePlayerAvatar('game-opponent-photo', 'game-opponent-initials', opponent);
    }

    // Highlight active player
    if (gameState.currentTurn === 'X') {
        playerXCard?.classList.add('active');
        playerOCard?.classList.remove('active');
    } else {
        playerXCard?.classList.remove('active');
        playerOCard?.classList.add('active');
    }
}

/**
 * Update the player avatar image or fallback initials.
 */
function updatePlayerAvatar(imgId, fallbackId, userData) {
    const imgEl = document.getElementById(imgId);
    const fallbackEl = document.getElementById(fallbackId);

    if (!imgEl || !fallbackEl) return;

    if (userData?.photo_url) {
        imgEl.src = userData.photo_url;
        imgEl.style.display = 'block';
        fallbackEl.style.display = 'none';
    } else {
        imgEl.style.display = 'none';
        fallbackEl.style.display = 'flex';
        fallbackEl.textContent = getUserInitials(
            userData?.first_name || 'P',
            userData?.last_name || ''
        );
    }
}

/**
 * Update the turn indicator text and style.
 */
function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    const text = indicator?.querySelector('.turn-text');

    if (!indicator || !text) return;

    if (gameState.gameOver) {
        indicator.classList.remove('opponent-turn');
        indicator.classList.add('game-over');
        text.textContent = 'Game Over';
    } else if (gameState.isMyTurn) {
        indicator.classList.remove('opponent-turn');
        indicator.classList.remove('game-over');
        text.textContent = 'Your turn!';
    } else {
        indicator.classList.add('opponent-turn');
        indicator.classList.remove('game-over');
        text.textContent = gameState.isAI ? 'AI thinking...' : "Opponent's turn";
    }
}

/**
 * Update the visual board to match the current state.
 */
function updateBoardUI() {
    const cells = document.querySelectorAll('.cell');

    cells.forEach((cell, index) => {
        const symbol = gameState.board[index];

        // Clear previous state
        cell.textContent = '';
        cell.className = 'cell';

        if (symbol !== '-') {
            cell.textContent = symbol;
            cell.classList.add('taken');
            cell.classList.add(`symbol-${symbol.toLowerCase()}`);
        }
    });
}

/**
 * Highlight the winning cells on the board.
 * @param {number[]} line - Array of 3 cell indices
 */
function highlightWinningCells(line) {
    const cells = document.querySelectorAll('.cell');

    line.forEach((index) => {
        cells[index]?.classList.add('winning');
    });

    // Haptic feedback for win
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }
}

/**
 * Enable/disable board interaction based on whose turn it is.
 */
function updateBoardInteraction() {
    const cells = document.querySelectorAll('.cell');

    cells.forEach((cell, index) => {
        // Remove old click listeners by cloning (simple approach)
        const newCell = cell.cloneNode(true);
        cell.parentNode.replaceChild(newCell, cell);

        // Only add click listener if it's our turn and cell is empty
        if (gameState.isMyTurn && !gameState.gameOver && gameState.board[index] === '-') {
            newCell.addEventListener('click', () => handleCellClick(index));
            newCell.style.cursor = 'pointer';
        } else {
            newCell.style.cursor = 'default';
        }
    });
}

/**
 * Update the match status badge.
 */
function updateMatchStatus() {
    const statusEl = document.getElementById('match-status');
    const badge = statusEl?.querySelector('.status-badge');

    if (!badge) return;

    const statusMap = {
        'waiting': 'Waiting to start',
        'active': 'Match in progress',
        'completed': 'Match ended',
        'abandoned': 'Match abandoned',
    };

    badge.textContent = statusMap[gameState.status] || gameState.status;
}

/**
 * Get the current game state (read-only).
 * Useful for debugging and the app controller.
 */
function getGameState() {
    return { ...gameState };
}
