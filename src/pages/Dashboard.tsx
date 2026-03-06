import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, Trophy, LogOut, Gamepad2, ArrowRight, Star } from 'lucide-react';
import { generateInviteCode } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export default function Dashboard() {
  const { profile, signOut } = useAuth();
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextLevelXp, setNextLevelXp] = useState<number | null>(null);
  const [currentLevelXp, setCurrentLevelXp] = useState<number>(0);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (profile) {
      fetchLevelProgress();
      fetchLeaderboard();

      // Subscribe to leaderboard changes
      const leaderboardChannel = supabase
        .channel('leaderboard_updates')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'leaderboard' },
          () => fetchLeaderboard()
        )
        .subscribe();

      // Subscribe to user profile changes (for XP/Level updates)
      const userChannel = supabase
        .channel(`user_updates:${profile.user_id}`)
        .on(
          'postgres_changes',
          { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'users',
            filter: `user_id=eq.${profile.user_id}`
          },
          () => {
            // Re-fetch profile data or just let the auth hook handle it if it does
            // For now, we manually trigger level progress refresh
            fetchLevelProgress();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(leaderboardChannel);
        supabase.removeChannel(userChannel);
      };
    }
  }, [profile?.user_id]);

  async function fetchLeaderboard() {
    if (!isSupabaseConfigured) {
      // Mock leaderboard for demo mode
      setLeaderboard([
        { user_id: '1', wins: 15, xp: 2450, users: { username: 'ProGamer_99' } },
        { user_id: '2', wins: 12, xp: 1800, users: { username: 'ShadowStrike' } },
        { user_id: '3', wins: 8, xp: 1250, users: { username: 'Casual_Cat' } }
      ]);
      return;
    }

    try {
      const { data } = await supabase
        .from('leaderboard')
        .select(`
          *,
          users:user_id (
            username
          )
        `)
        .order('xp', { ascending: false })
        .limit(5);

      if (data) setLeaderboard(data);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
    }
  }

  async function fetchLevelProgress() {
    if (!profile) return;

    if (!isSupabaseConfigured) {
      // Mock levels for demo mode
      const mockLevels = [
        { level: 1, xp_required: 0 },
        { level: 2, xp_required: 100 },
        { level: 3, xp_required: 300 },
        { level: 4, xp_required: 600 },
        { level: 5, xp_required: 1000 },
        { level: 6, xp_required: 1500 }
      ];
      
      const current = mockLevels.find(l => l.level === profile.level);
      const next = mockLevels.find(l => l.level === (profile.level || 1) + 1);
      
      setCurrentLevelXp(current?.xp_required || 0);
      setNextLevelXp(next?.xp_required || null);
      return;
    }

    try {
      const { data: levels } = await supabase
        .from('xp_levels')
        .select('*')
        .order('level', { ascending: true });

      if (levels) {
        const current = levels.find(l => l.level === profile.level);
        const next = levels.find(l => l.level === (profile.level || 1) + 1);
        
        setCurrentLevelXp(current?.xp_required || 0);
        setNextLevelXp(next?.xp_required || null);
      }
    } catch (err) {
      console.error('Error fetching levels:', err);
    }
  }

  const progress = nextLevelXp 
    ? Math.min(100, Math.max(0, ((profile?.xp || 0) - currentLevelXp) / (nextLevelXp - currentLevelXp) * 100))
    : 100;

  const createRoom = async (gameType: 'tic-tac-toe' | 'rps') => {
    setLoading(true);
    const code = generateInviteCode();
    
    try {
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .insert({
          room_code: code,
          game_type: gameType,
          host_id: profile?.user_id,
          max_players: 2,
          status: 'waiting'
        })
        .select()
        .single();

      if (roomError) throw roomError;

      // Join the room as host
      const { error: playerError } = await supabase
        .from('room_players')
        .insert({
          room_id: room.room_id,
          user_id: profile?.user_id,
          symbol: gameType === 'tic-tac-toe' ? 'X' : null
        });

      if (playerError) throw playerError;

      navigate(`/room/${code}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const joinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode) return;
    setLoading(true);
    setError(null);

    try {
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', roomCode.toUpperCase())
        .single();

      if (roomError || !room) throw new Error('Room not found');
      if (room.status !== 'waiting') throw new Error('Game already started');

      // Check if already in room
      const { data: existingPlayer } = await supabase
        .from('room_players')
        .select('*')
        .eq('room_id', room.room_id)
        .eq('user_id', profile?.user_id)
        .single();

      if (!existingPlayer) {
        // Join the room
        const { error: joinError } = await supabase
          .from('room_players')
          .insert({
            room_id: room.room_id,
            user_id: profile?.user_id,
            symbol: room.game_type === 'tic-tac-toe' ? 'O' : null
          });

        if (joinError) throw joinError;
      }

      navigate(`/room/${room.room_code}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 pb-24 sm:pb-6">
      <header className="flex items-center justify-between mb-8 sm:mb-12">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Gamepad2 className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-950" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">OmniPlay</h1>
            <p className="text-zinc-500 text-xs sm:text-sm">Welcome, {profile?.username}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col gap-0.5 sm:gap-1 min-w-[120px] sm:min-w-[180px]">
            <div className="flex items-center justify-between">
              <p className="text-[8px] sm:text-[10px] text-zinc-500 uppercase font-black tracking-wider">Level {profile?.level}</p>
              <p className="text-[8px] sm:text-[10px] text-zinc-400 font-mono">{profile?.xp}{nextLevelXp ? ` / ${nextLevelXp}` : ''} XP</p>
            </div>
            <div className="h-1 sm:h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
              />
            </div>
          </div>
          <button 
            onClick={signOut}
            className="p-2 sm:p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-500 transition-all"
          >
            <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        <div className="lg:col-span-2 space-y-6 sm:space-y-8">
          <section>
            <h2 className="text-base sm:text-lg font-semibold mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
              Create a Match
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <button 
                onClick={() => createRoom('tic-tac-toe')}
                disabled={loading}
                className="group p-5 sm:p-6 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-emerald-500/50 transition-all text-left relative overflow-hidden active:scale-[0.98]"
              >
                <div className="relative z-10">
                  <h3 className="text-lg sm:text-xl font-bold mb-1">Tic Tac Toe</h3>
                  <p className="text-zinc-500 text-xs sm:text-sm">Classic 3x3 strategy</p>
                </div>
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Gamepad2 className="w-12 h-12 sm:w-16 sm:h-16" />
                </div>
              </button>
              <button 
                onClick={() => createRoom('rps')}
                disabled={loading}
                className="group p-5 sm:p-6 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-emerald-500/50 transition-all text-left relative overflow-hidden active:scale-[0.98]"
              >
                <div className="relative z-10">
                  <h3 className="text-lg sm:text-xl font-bold mb-1">Rock Paper Scissors</h3>
                  <p className="text-zinc-500 text-xs sm:text-sm">Simultaneous battle</p>
                </div>
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Gamepad2 className="w-12 h-12 sm:w-16 sm:h-16" />
                </div>
              </button>
            </div>
          </section>

          <section>
            <h2 className="text-base sm:text-lg font-semibold mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
              Join with Code
            </h2>
            <form onSubmit={joinRoom} className="flex gap-2 sm:gap-3">
              <input 
                type="text"
                placeholder="ENTER CODE"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-mono tracking-widest text-sm sm:text-base"
              />
              <button 
                type="submit"
                disabled={loading || !roomCode}
                className="bg-emerald-500 hover:bg-emerald-600 text-zinc-950 px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-50 text-sm sm:text-base"
              >
                Join <ArrowRight className="w-4 h-4" />
              </button>
            </form>
            {error && <p className="text-red-500 text-[10px] sm:text-sm mt-2 ml-1">{error}</p>}
          </section>
        </div>

        <aside className="space-y-6 sm:space-y-8">
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold mb-6 flex items-center gap-2">
              <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
              Live Leaderboard
            </h2>
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {leaderboard.map((entry, i) => (
                  <motion.div 
                    key={entry.user_id} 
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      entry.user_id === profile?.user_id 
                        ? 'bg-emerald-500/5 border-emerald-500/20' 
                        : 'bg-zinc-950 border-zinc-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-bold w-4 ${
                        i === 0 ? 'text-amber-500' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-amber-700' : 'text-zinc-500'
                      }`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </span>
                      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-500 border border-zinc-700">
                        {entry.users?.username?.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium truncate max-w-[80px] sm:max-w-[100px]">{entry.users?.username}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-mono text-emerald-500">{entry.xp.toLocaleString()} XP</p>
                      <p className="text-[8px] text-zinc-600 uppercase font-bold">{entry.wins} Wins</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {leaderboard.length === 0 && (
                <p className="text-center text-zinc-600 text-xs py-8 italic">No entries yet. Start playing to rank up!</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
