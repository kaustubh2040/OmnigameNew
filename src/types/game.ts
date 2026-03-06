export type GameType = 'tic-tac-toe' | 'rps';

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface Profile {
  user_id: string;
  username: string;
  email: string;
  xp: number;
  level: number;
  created_at: string;
}

export interface Room {
  room_id: string;
  room_code: string;
  game_type: GameType;
  status: RoomStatus;
  host_id: string;
  max_players: number;
  created_at: string;
}

export interface RoomPlayer {
  id: string;
  room_id: string;
  user_id: string;
  symbol?: string;
  joined_at: string;
  // Joined profile data
  users?: Profile;
}

export interface MatchState {
  turn?: string; // user_id
  winner?: string | 'draw';
  board?: (string | null)[]; // For Tic Tac Toe
  moves?: Record<string, string | null>; // For RPS
  round?: number;
  rematch_requests?: string[]; // Array of user_ids
  next_match_id?: string;
}

export interface Match {
  match_id: string;
  room_id: string;
  game_state: MatchState;
  current_turn?: string;
  winner?: string;
  status: 'active' | 'completed' | 'draw';
  created_at: string;
}
