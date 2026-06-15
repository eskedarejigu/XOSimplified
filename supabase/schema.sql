--
-- XO Arena - Complete Database Schema
-- 
-- Run this SQL in your Supabase SQL Editor to set up:
-- 1. All tables (users, waiting_queue, matches, moves)
-- 2. Indexes for performance
-- 3. Row Level Security (RLS) policies
-- 4. Database functions and triggers
-- 5. Realtime configuration
--

-- ==================== ENABLE EXTENSIONS ====================
-- UUID extension for generating unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== DROP EXISTING (CLEAN INSTALL) ====================
-- Uncomment these lines if you need to reset everything
-- DROP TABLE IF EXISTS moves CASCADE;
-- DROP TABLE IF EXISTS matches CASCADE;
-- DROP TABLE IF EXISTS waiting_queue CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;

-- ==================== USERS TABLE ====================
-- Stores all players who have used the app
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id TEXT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT NOT NULL DEFAULT 'Player',
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: telegram_id must be a non-empty string
    CONSTRAINT valid_telegram_id CHECK (char_length(telegram_id) > 0)
);

-- Index: Fast lookup by telegram_id (used on every login)
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- Index: Recently created users (for admin queries)
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- ==================== WAITING QUEUE TABLE ====================
-- Stores players waiting for an opponent
CREATE TABLE IF NOT EXISTS waiting_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: each user can only be in queue once
    CONSTRAINT unique_user_in_queue UNIQUE (user_id)
);

-- Index: FIFO ordering - oldest first gets matched first
CREATE INDEX IF NOT EXISTS idx_queue_joined_at ON waiting_queue(joined_at ASC);

-- Index: Fast check if a specific user is in queue
CREATE INDEX IF NOT EXISTS idx_queue_user_id ON waiting_queue(user_id);

-- ==================== MATCHES TABLE ====================
-- Stores all game matches
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_x UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_o TEXT NOT NULL,  -- Can be user ID (as text) or 'ai_opponent'
    board_state CHAR(9) NOT NULL DEFAULT '---------',
    current_turn CHAR(1) NOT NULL DEFAULT 'X' CHECK (current_turn IN ('X', 'O')),
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' 
        CHECK (status IN ('waiting', 'active', 'completed', 'abandoned')),
    winner UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: board_state must be exactly 9 characters of X, O, or -
    CONSTRAINT valid_board_state CHECK (board_state ~ '^[XO-]{9}$')
);

-- Index: Fast lookup by player (for game history)
CREATE INDEX IF NOT EXISTS idx_matches_player_x ON matches(player_x);
CREATE INDEX IF NOT EXISTS idx_matches_player_o ON matches(player_o);

-- Index: Active matches (for finding ongoing games)
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status) 
    WHERE status IN ('waiting', 'active');

-- Index: Matches by creation time
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at DESC);

-- ==================== MOVES TABLE ====================
-- Stores complete move history for every match
CREATE TABLE IF NOT EXISTS moves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,  -- user UUID or 'ai_opponent'
    position INTEGER NOT NULL CHECK (position >= 0 AND position <= 8),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: each position in a match can only have one move
    CONSTRAINT unique_match_position UNIQUE (match_id, position)
);

-- Index: Fast lookup of moves by match
CREATE INDEX IF NOT EXISTS idx_moves_match_id ON moves(match_id);

-- Index: Moves in chronological order
CREATE INDEX IF NOT EXISTS idx_moves_created_at ON moves(created_at ASC);

-- ==================== ROW LEVEL SECURITY (RLS) ====================
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiting_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves ENABLE ROW LEVEL SECURITY;

-- ==================== RLS POLICIES FOR USERS TABLE ====================

-- Anyone can read users (needed to see opponent info)
CREATE POLICY "Users are viewable by everyone" 
    ON users FOR SELECT 
    USING (true);

-- Only the service role can insert users (via Edge Function)
CREATE POLICY "Users can be created by service role" 
    ON users FOR INSERT 
    WITH CHECK (false);  -- Only via service role or Edge Function

-- Users can update their own record
CREATE POLICY "Users can update own record" 
    ON users FOR UPDATE 
    USING (telegram_id = current_setting('app.current_telegram_id', true));

-- ==================== RLS POLICIES FOR WAITING QUEUE ====================

-- Anyone can view the queue (needed for matchmaking)
CREATE POLICY "Queue is viewable by everyone" 
    ON waiting_queue FOR SELECT 
    USING (true);

-- Users can add themselves to queue
CREATE POLICY "Users can join queue" 
    ON waiting_queue FOR INSERT 
    WITH CHECK (true);

-- Users can only remove themselves from queue
CREATE POLICY "Users can leave queue" 
    ON waiting_queue FOR DELETE 
    USING (true);  -- We'll handle this in the application logic

-- ==================== RLS POLICIES FOR MATCHES ====================

-- Players can view their own matches
CREATE POLICY "Players can view their matches" 
    ON matches FOR SELECT 
    USING (player_x = auth.uid() OR player_o = auth.uid()::text);

-- Matches can be created by players
CREATE POLICY "Players can create matches" 
    ON matches FOR INSERT 
    WITH CHECK (player_x = auth.uid() OR player_o = auth.uid()::text);

-- Players can update their active matches
CREATE POLICY "Players can update their matches" 
    ON matches FOR UPDATE 
    USING (player_x = auth.uid() OR player_o = auth.uid()::text);

-- ==================== RLS POLICIES FOR MOVES ====================

-- Players can view moves in their matches
CREATE POLICY "Players can view match moves" 
    ON moves FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM matches 
            WHERE matches.id = moves.match_id 
            AND (matches.player_x = auth.uid() OR matches.player_o = auth.uid()::text)
        )
    );

-- Players can record moves in their matches
CREATE POLICY "Players can record moves" 
    ON moves FOR INSERT 
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM matches 
            WHERE matches.id = moves.match_id 
            AND (matches.player_x = auth.uid() OR matches.player_o = auth.uid()::text)
        )
    );

-- ==================== DATABASE FUNCTIONS ====================

-- Function: Automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update updated_at on matches
CREATE TRIGGER update_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function: Clean up waiting queue when match is created
CREATE OR REPLACE FUNCTION cleanup_queue_on_match()
RETURNS TRIGGER AS $$
BEGIN
    -- Remove both players from waiting queue when a match starts
    DELETE FROM waiting_queue WHERE user_id = NEW.player_x;
    IF NEW.player_o <> 'ai_opponent' THEN
        DELETE FROM waiting_queue WHERE user_id = NEW.player_o::uuid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Clean up queue after match insert
CREATE TRIGGER cleanup_queue_after_match
    AFTER INSERT ON matches
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_queue_on_match();

-- Function: Validate a move before recording
CREATE OR REPLACE FUNCTION validate_move(
    p_match_id UUID,
    p_player_id TEXT,
    p_position INTEGER
)
RETURNS TABLE (
    valid BOOLEAN,
    message TEXT
) AS $$
DECLARE
    v_match RECORD;
    v_board CHAR(9);
    v_current_turn CHAR(1);
    v_expected_player UUID;
    v_symbol CHAR(1);
    v_existing_move INTEGER;
BEGIN
    -- Get match details
    SELECT * INTO v_match FROM matches WHERE id = p_match_id;
    
    -- Check match exists
    IF v_match IS NULL THEN
        RETURN QUERY SELECT false, 'Match not found'::TEXT;
        RETURN;
    END IF;
    
    -- Check match is active
    IF v_match.status != 'active' THEN
        RETURN QUERY SELECT false, 'Match is not active'::TEXT;
        RETURN;
    END IF;
    
    -- Check position is valid (0-8)
    IF p_position < 0 OR p_position > 8 THEN
        RETURN QUERY SELECT false, 'Invalid position'::TEXT;
        RETURN;
    END IF;

    -- Check position is empty
    IF substring(v_match.board_state from p_position + 1 for 1) != '-' THEN
        RETURN QUERY SELECT false, 'Position already taken'::TEXT;
        RETURN;
    END IF;
    
    -- Determine which symbol the player should be
    IF v_match.player_x::text = p_player_id THEN
        v_symbol := 'X';
    ELSIF v_match.player_o::text = p_player_id OR p_player_id = 'ai_opponent' THEN
        v_symbol := 'O';
    ELSE
        RETURN QUERY SELECT false, 'You are not a player in this match'::TEXT;
        RETURN;
    END IF;
    
    -- Check it's the correct turn
    IF v_match.current_turn != v_symbol THEN
        RETURN QUERY SELECT false, 'Not your turn'::TEXT;
        RETURN;
    END IF;
    
    -- Check position hasn't been played
    SELECT position INTO v_existing_move 
    FROM moves 
    WHERE match_id = p_match_id AND position = p_position;
    
    IF v_existing_move IS NOT NULL THEN
        RETURN QUERY SELECT false, 'Position already played'::TEXT;
        RETURN;
    END IF;
    
    -- All checks passed
    RETURN QUERY SELECT true, 'Valid move'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Function: Check for a winner
CREATE OR REPLACE FUNCTION check_winner(p_board CHAR(9))
RETURNS CHAR(1) AS $$
DECLARE
    winning_lines INTEGER[][] := ARRAY[
        ARRAY[0,1,2], ARRAY[3,4,5], ARRAY[6,7,8],  -- rows
        ARRAY[0,3,6], ARRAY[1,4,7], ARRAY[2,5,8],  -- columns
        ARRAY[0,4,8], ARRAY[2,4,6]                   -- diagonals
    ];
    line INTEGER[];
    a INTEGER;
    b INTEGER;
    c INTEGER;
    sym CHAR(1);
BEGIN
    -- Check all winning lines
    FOREACH line SLICE 1 IN ARRAY winning_lines
    LOOP
        a := line[1];
        b := line[2];
        c := line[3];
        
        sym := substring(p_board from a + 1 for 1);
        
        IF sym != '-' AND 
           substring(p_board from b + 1 for 1) = sym AND 
           substring(p_board from c + 1 for 1) = sym THEN
            RETURN sym;
        END IF;
    END LOOP;
    
    -- No winner
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function: Check if board is full (draw)
CREATE OR REPLACE FUNCTION is_board_full(p_board CHAR(9))
RETURNS BOOLEAN AS $$
BEGIN
    RETURN position('-' in p_board) = 0;
END;
$$ LANGUAGE plpgsql;

-- Function: Get match statistics for a user
CREATE OR REPLACE FUNCTION get_user_stats(p_user_id UUID)
RETURNS TABLE (
    total_games BIGINT,
    wins BIGINT,
    losses BIGINT,
    draws BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_games,
        COUNT(*) FILTER (WHERE matches.winner = p_user_id)::BIGINT as wins,
        COUNT(*) FILTER (WHERE matches.winner IS NOT NULL AND matches.winner != p_user_id)::BIGINT as losses,
        COUNT(*) FILTER (WHERE matches.winner IS NULL AND matches.status = 'completed')::BIGINT as draws
    FROM matches
    WHERE (matches.player_x = p_user_id OR matches.player_o = p_user_id)
    AND matches.status = 'completed';
END;
$$ LANGUAGE plpgsql;

-- ==================== REALTIME CONFIGURATION ====================
-- Enable realtime for the tables we need live updates on

-- Enable realtime for matches table
ALTER PUBLICATION supabase_realtime ADD TABLE matches;

-- Enable realtime for moves table
ALTER PUBLICATION supabase_realtime ADD TABLE moves;

-- Enable realtime for waiting_queue table
ALTER PUBLICATION supabase_realtime ADD TABLE waiting_queue;

-- ==================== VIEWS ====================

-- View: Active matches with player info
CREATE OR REPLACE VIEW active_matches_view AS
SELECT 
    m.id,
    m.board_state,
    m.current_turn,
    m.status,
    m.created_at,
    m.updated_at,
    px.first_name as player_x_name,
    px.username as player_x_username,
    po.first_name as player_o_name,
    po.username as player_o_username
FROM matches m
LEFT JOIN users px ON m.player_x = px.id
LEFT JOIN users po ON m.player_o = po.id::text
WHERE m.status IN ('waiting', 'active');

-- View: Match history with results
CREATE OR REPLACE VIEW match_history_view AS
SELECT 
    m.id,
    m.board_state,
    m.status,
    m.winner,
    m.created_at,
    px.first_name as player_x_name,
    po.first_name as player_o_name,
    CASE 
        WHEN m.winner = m.player_x THEN px.first_name
        WHEN m.winner::text = m.player_o THEN po.first_name
        ELSE 'Draw'
    END as winner_name,
    COUNT(mv.id) as total_moves
FROM matches m
LEFT JOIN users px ON m.player_x = px.id
LEFT JOIN users po ON m.player_o = po.id::text
LEFT JOIN moves mv ON m.id = mv.match_id
WHERE m.status = 'completed'
GROUP BY m.id, px.first_name, po.first_name;

-- ==================== QUEUE CLEANUP (OPTIONAL) ====================
-- Function to clean up stale queue entries (older than 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_stale_queue()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM waiting_queue 
    WHERE joined_at < NOW() - INTERVAL '5 minutes';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ==================== INSERT SAMPLE DATA (FOR TESTING) ====================
-- Uncomment these lines if you want to test with sample data

-- INSERT INTO users (telegram_id, username, first_name) 
-- VALUES ('123456789', 'testplayer1', 'Test Player 1')
-- ON CONFLICT (telegram_id) DO NOTHING;

-- INSERT INTO users (telegram_id, username, first_name) 
-- VALUES ('987654321', 'testplayer2', 'Test Player 2')
-- ON CONFLICT (telegram_id) DO NOTHING;

-- ==================== VERIFICATION QUERY ====================
-- Run this to verify everything was created properly:
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- SELECT policyname, tablename, permissive FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;
