-- MULTIPLAYER GAMING PLATFORM SCHEMA

-- 1. Users (Profiles)
-- Note: This table extends Supabase Auth. 
-- You should set up a trigger to insert into this table when a new user signs up.
CREATE TABLE IF NOT EXISTS users (
    user_id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    xp INTEGER DEFAULT 0 CHECK (xp >= 0),
    level INTEGER DEFAULT 1 CHECK (level >= 1),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Rooms
CREATE TABLE IF NOT EXISTS rooms (
    room_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    room_code TEXT UNIQUE NOT NULL, -- The invite code
    game_type TEXT NOT NULL, -- e.g., 'tic-tac-toe', 'rps'
    host_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
    max_players INTEGER DEFAULT 2,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Room Players
CREATE TABLE IF NOT EXISTS room_players (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    room_id UUID REFERENCES rooms(room_id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    symbol TEXT, -- e.g., 'X' or 'O' for Tic Tac Toe
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(room_id, user_id) -- A user can only be in a room once
);

-- 4. Matches
CREATE TABLE IF NOT EXISTS matches (
    match_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    room_id UUID REFERENCES rooms(room_id) ON DELETE CASCADE,
    game_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    current_turn UUID REFERENCES users(user_id),
    winner UUID REFERENCES users(user_id),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'draw')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Leaderboard
CREATE TABLE IF NOT EXISTS leaderboard (
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE PRIMARY KEY,
    wins INTEGER DEFAULT 0 CHECK (wins >= 0),
    losses INTEGER DEFAULT 0 CHECK (losses >= 0),
    xp INTEGER DEFAULT 0 CHECK (xp >= 0),
    rank INTEGER -- Can be updated via a scheduled function or trigger
);

-- 6. XP Levels
CREATE TABLE IF NOT EXISTS xp_levels (
    level INTEGER PRIMARY KEY,
    xp_required INTEGER NOT NULL,
    reward JSONB DEFAULT '{}'::jsonb
);

-- INDEXES FOR FAST LOOKUP
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_room_players_room ON room_players(room_id);
CREATE INDEX IF NOT EXISTS idx_room_players_user ON room_players(user_id);
CREATE INDEX IF NOT EXISTS idx_matches_room ON matches(room_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_xp ON leaderboard(xp DESC);

-- SEED DATA FOR XP LEVELS
INSERT INTO xp_levels (level, xp_required, reward) VALUES
(1, 0, '{"badge": "Novice"}'),
(2, 100, '{"badge": "Apprentice"}'),
(3, 300, '{"badge": "Warrior"}'),
(4, 600, '{"badge": "Veteran"}'),
(5, 1000, '{"badge": "Master"}')
ON CONFLICT (level) DO NOTHING;

-- RLS POLICIES (Basic Setup)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;

-- Public profiles are readable by everyone
CREATE POLICY "Public profiles are viewable by everyone" ON users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = user_id);

-- Rooms are viewable by everyone (to join)
CREATE POLICY "Rooms are viewable by everyone" ON rooms FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create rooms" ON rooms FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Room players
CREATE POLICY "Room players are viewable by everyone" ON room_players FOR SELECT USING (true);
CREATE POLICY "Users can join rooms" ON room_players FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Matches
CREATE POLICY "Matches are viewable by room participants" ON matches FOR SELECT USING (true);
CREATE POLICY "Participants can update match state" ON matches FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM room_players 
    WHERE room_players.room_id = matches.room_id 
    AND room_players.user_id = auth.uid()
  )
);
