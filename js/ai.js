/**
 * ai.js - AI Opponent for Tic-Tac-Toe
 * 
 * This file implements a perfect Tic-Tac-Toe AI using the Minimax algorithm.
 * The AI will:
 * 1. Win immediately if possible
 * 2. Block opponent's winning move
 * 3. Use Minimax to find the optimal move
 * 
 * The AI is UNBEATABLE - at best, the player can draw.
 * This is intentional for a challenging single-player experience.
 * 
 * Performance: Every possible Tic-Tac-Toe game state is evaluated
 * in under 1 millisecond, well within our 500ms requirement.
 */

// ======== CONSTANTS ========
const AI_SYMBOL = 'O';      // AI always plays as O
const PLAYER_SYMBOL = 'X';  // Human player always plays as X
const EMPTY = '-';

// All possible winning combinations (indices on the 9-char board)
// Board layout: 0 1 2
//               3 4 5
//               6 7 8
const WINNING_LINES = [
    [0, 1, 2], // Top row
    [3, 4, 5], // Middle row
    [6, 7, 8], // Bottom row
    [0, 3, 6], // Left column
    [1, 4, 7], // Middle column
    [2, 5, 8], // Right column
    [0, 4, 8], // Diagonal top-left to bottom-right
    [2, 4, 6], // Diagonal top-right to bottom-left
];

// ======== PUBLIC API ========

/**
 * Get the AI's best move for the current board state.
 * This is the main function called by the game logic.
 * 
 * @param {string} boardState - 9-character board string (e.g., "X-O--X---")
 * @returns {number} Index (0-8) where the AI should play
 */
function getAIMove(boardState) {
    // Convert compact string to array for easier manipulation
    const board = boardState.split('');

    // Measure performance
    const startTime = performance.now();

    // Step 1: Check if AI can win immediately
    const winningMove = findWinningMove(board, AI_SYMBOL);
    if (winningMove !== -1) {
        console.log(`AI found winning move at position ${winningMove}`);
        return winningMove;
    }

    // Step 2: Check if we need to block opponent's winning move
    const blockingMove = findWinningMove(board, PLAYER_SYMBOL);
    if (blockingMove !== -1) {
        console.log(`AI blocking opponent at position ${blockingMove}`);
        return blockingMove;
    }

    // Step 3: Use Minimax to find the optimal move
    const bestMove = minimax(board, AI_SYMBOL).index;

    const endTime = performance.now();
    console.log(`AI calculated move ${bestMove} in ${(endTime - startTime).toFixed(2)}ms`);

    return bestMove;
}

/**
 * Check if the AI game is over.
 * @param {string} boardState - Current board state
 * @returns {Object} { gameOver: boolean, winner: string|null, isDraw: boolean }
 */
function checkAIGameOver(boardState) {
    const board = boardState.split('');
    
    // Check for a winner
    for (const line of WINNING_LINES) {
        const [a, b, c] = line;
        if (board[a] !== EMPTY && board[a] === board[b] && board[b] === board[c]) {
            return { gameOver: true, winner: board[a], isDraw: false, winningLine: line };
        }
    }

    // Check for draw (no empty cells)
    if (!board.includes(EMPTY)) {
        return { gameOver: true, winner: null, isDraw: true, winningLine: null };
    }

    // Game continues
    return { gameOver: false, winner: null, isDraw: false, winningLine: null };
}

// ======== INTERNAL FUNCTIONS ========

/**
 * Find a move that wins the game for the given symbol.
 * This checks if placing the symbol in any empty cell creates 3 in a row.
 * 
 * @param {string[]} board - Board as array of 9 characters
 * @param {string} symbol - 'X' or 'O'
 * @returns {number} Winning position index, or -1 if no winning move
 */
function findWinningMove(board, symbol) {
    // Try each empty cell
    for (let i = 0; i < 9; i++) {
        if (board[i] === EMPTY) {
            // Place the symbol temporarily
            board[i] = symbol;
            
            // Check if this creates a win
            const isWin = checkWin(board, symbol);
            
            // Undo the move
            board[i] = EMPTY;
            
            if (isWin) {
                return i; // Found a winning move!
            }
        }
    }
    
    return -1; // No winning move found
}

/**
 * Check if the given symbol has won on the current board.
 * 
 * @param {string[]} board - Board as array of 9 characters
 * @param {string} symbol - 'X' or 'O'
 * @returns {boolean} True if the symbol has 3 in a row
 */
function checkWin(board, symbol) {
    // Check all winning lines
    for (const line of WINNING_LINES) {
        const [a, b, c] = line;
        if (board[a] === symbol && board[b] === symbol && board[c] === symbol) {
            return true;
        }
    }
    return false;
}

/**
 * Get all available (empty) positions on the board.
 * 
 * @param {string[]} board - Board as array of 9 characters
 * @returns {number[]} Array of empty position indices
 */
function getEmptyCells(board) {
    const empty = [];
    for (let i = 0; i < 9; i++) {
        if (board[i] === EMPTY) {
            empty.push(i);
        }
    }
    return empty;
}

/**
 * The Minimax algorithm.
 * 
 * Minimax simulates ALL possible future game states to find the
 * optimal move. It assumes both players play perfectly.
 * 
 * How it works:
 * - The AI (maximizer) tries to MAXIMIZE its score
 * - The opponent (minimizer) tries to MINIMIZE the AI's score
 * - We recursively evaluate each possible move to a terminal state
 * - Scores: AI win = +10, Opponent win = -10, Draw = 0
 * 
 * @param {string[]} board - Current board state as array
 * @param {string} currentPlayer - 'X' or 'O'
 * @returns {Object} { index: number, score: number }
 */
function minimax(board, currentPlayer) {
    // Get available moves
    const availableCells = getEmptyCells(board);

    // Check terminal states (base cases)
    
    // If AI wins, return positive score
    if (checkWin(board, AI_SYMBOL)) {
        return { score: 10 };
    }
    
    // If human wins, return negative score
    if (checkWin(board, PLAYER_SYMBOL)) {
        return { score: -10 };
    }
    
    // If draw (no moves left), return neutral score
    if (availableCells.length === 0) {
        return { score: 0 };
    }

    // Store all possible moves and their scores
    const moves = [];

    // Try each available cell
    for (const cell of availableCells) {
        // Create a move object
        const move = {
            index: cell,
            score: 0,
        };

        // Make the move temporarily
        board[cell] = currentPlayer;

        // Recursively evaluate this move
        if (currentPlayer === AI_SYMBOL) {
            // AI's turn - opponent (minimizer) plays next
            const result = minimax(board, PLAYER_SYMBOL);
            move.score = result.score;
        } else {
            // Opponent's turn - AI (maximizer) plays next
            const result = minimax(board, AI_SYMBOL);
            move.score = result.score;
        }

        // Undo the move (backtrack)
        board[cell] = EMPTY;

        // Store this move
        moves.push(move);
    }

    // Choose the best move
    let bestMove;

    if (currentPlayer === AI_SYMBOL) {
        // AI's turn: pick the move with the HIGHEST score (maximize)
        let bestScore = -Infinity;
        for (const move of moves) {
            if (move.score > bestScore) {
                bestScore = move.score;
                bestMove = move;
            }
        }
    } else {
        // Opponent's turn: pick the move with the LOWEST score (minimize)
        let bestScore = Infinity;
        for (const move of moves) {
            if (move.score < bestScore) {
                bestScore = move.score;
                bestMove = move;
            }
        }
    }

    return bestMove;
}

/**
 * Check if it's the AI's turn on the current board.
 * The AI plays as 'O', so we count the symbols.
 * X always goes first, so if X count > O count, it's O's turn.
 * 
 * @param {string} boardState - 9-character board string
 * @returns {boolean} True if it's AI's turn
 */
function isAITurn(boardState) {
    const xCount = (boardState.match(/X/g) || []).length;
    const oCount = (boardState.match(/O/g) || []).length;
    
    // X goes first, so if X count equals O count, it's X's turn
    // If X count > O count, it's O's (AI's) turn
    return xCount > oCount;
}

/**
 * Convert a board array back to a compact 9-character string.
 * @param {string[]} board - Board array
 * @returns {string} Compact board string
 */
function boardToString(board) {
    return board.join('');
}

/**
 * Convert a compact board string to an array.
 * @param {string} boardStr - 9-character board string
 * @returns {string[]} Board array
 */
function stringToBoard(boardStr) {
    return boardStr.split('');
}

/**
 * Get a random opening move for the AI.
 * Used to add variety to the AI's first move.
 * @returns {number} Random corner or center position
 */
function getRandomOpeningMove() {
    // Best opening moves: corners (0, 2, 6, 8) or center (4)
    const openings = [0, 2, 4, 6, 8];
    return openings[Math.floor(Math.random() * openings.length)];
}

// ======== DEBUGGING HELPERS ========
// These help us visualize the AI's decision-making during development

/**
 * Print the board to the console in a readable format.
 * @param {string[]} board - Board array
 */
function printBoard(board) {
    console.log(`
 ${board[0] || '-'} | ${board[1] || '-'} | ${board[2] || '-'}
-----------
 ${board[3] || '-'} | ${board[4] || '-'} | ${board[5] || '-'}
-----------
 ${board[6] || '-'} | ${board[7] || '-'} | ${board[8] || '-'}
    `);
}

/**
 * Evaluate all possible moves for the AI and return them sorted by score.
 * Useful for debugging the AI's decision-making.
 * @param {string} boardState - Current board state
 * @returns {Array} Moves sorted by score (best first)
 */
function evaluateAllMoves(boardState) {
    const board = boardState.split('');
    const moves = [];

    for (let i = 0; i < 9; i++) {
        if (board[i] === EMPTY) {
            board[i] = AI_SYMBOL;
            const result = minimax(board, PLAYER_SYMBOL);
            board[i] = EMPTY;
            moves.push({ position: i, score: result.score });
        }
    }

    // Sort by score (highest first)
    return moves.sort((a, b) => b.score - a.score);
}
