import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Room, RoomPlayer, Profile } from '../types/game';
import { Users, Copy, Check, Play, ArrowLeft, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function RoomPage() {
  const { code } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!code) return;
    fetchRoomData();

    // Subscribe to room_players changes
    const channel = supabase
      .channel(`room:${code}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
        },
        () => {
          fetchPlayers();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `room_code=eq.${code}`,
        },
        (payload) => {
          const updatedRoom = payload.new as Room;
          if (updatedRoom.status === 'playing') {
            // Game started! Redirect to match
            fetchActiveMatch(updatedRoom.room_id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [code]);

  async function fetchActiveMatch(roomId: string) {
    const { data, error } = await supabase
      .from('matches')
      .select('match_id')
      .eq('room_id', roomId)
      .eq('status', 'active')
      .single();

    if (!error && data) {
      navigate(`/match/${data.match_id}`);
    }
  }

  async function fetchRoomData() {
    try {
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', code)
        .single();

      if (roomError || !roomData) throw new Error('Room not found');
      setRoom(roomData);
      await fetchPlayers(roomData.room_id);
    } catch (err) {
      console.error(err);
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function fetchPlayers(roomId?: string) {
    const targetId = roomId || room?.room_id;
    if (!targetId) return;

    const { data, error } = await supabase
      .from('room_players')
      .select(`
        *,
        users:user_id (
          user_id,
          username,
          xp,
          level
        )
      `)
      .eq('room_id', targetId);

    if (!error && data) {
      setPlayers(data as any);
    }
  }

  const copyCode = () => {
    navigator.clipboard.writeText(code || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startGame = async () => {
    if (!room || players.length < 2) return;
    
    try {
      // 1. Create the match
      const initialState = {
        board: Array(9).fill(null),
        turn: room.host_id, // Host starts
        winner: null
      };

      const { data: match, error: matchError } = await supabase
        .from('matches')
        .insert({
          room_id: room.room_id,
          game_state: initialState,
          current_turn: room.host_id,
          status: 'active'
        })
        .select()
        .single();

      if (matchError) throw matchError;

      // 2. Update room status (this triggers redirection for guest)
      const { error: roomError } = await supabase
        .from('rooms')
        .update({ status: 'playing' })
        .eq('room_id', room.room_id);

      if (roomError) throw roomError;

      // 3. Navigate host
      navigate(`/match/${match.match_id}`);
    } catch (err) {
      console.error('Error starting game:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        <p className="text-zinc-500 animate-pulse">Entering room...</p>
      </div>
    );
  }

  const isHost = room?.host_id === profile?.user_id;
  const canStart = players.length >= 2;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <button 
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-2 text-zinc-500 hover:text-zinc-100 transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-1 block">
                  {room?.game_type === 'tic-tac-toe' ? 'Tic Tac Toe' : 'Rock Paper Scissors'}
                </span>
                <h1 className="text-3xl font-bold">Game Lobby</h1>
              </div>
              <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 px-4 py-2 rounded-2xl">
                <Users className="w-4 h-4 text-zinc-500" />
                <span className="font-mono">{players.length} / {room?.max_players}</span>
              </div>
            </div>

            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {players.map((player) => (
                  <motion.div
                    key={player.user_id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-2xl"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                        <span className="text-emerald-500 font-bold">
                          {player.users?.username?.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold flex items-center gap-2">
                          {player.users?.username}
                          {player.user_id === room?.host_id && (
                            <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded uppercase tracking-tighter border border-emerald-500/20">Host</span>
                          )}
                        </p>
                        <p className="text-xs text-zinc-500">Level {player.users?.level} • {player.users?.xp} XP</p>
                      </div>
                    </div>
                    {player.symbol && (
                      <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800 font-mono font-bold text-zinc-400">
                        {player.symbol}
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {Array.from({ length: (room?.max_players || 2) - players.length }).map((_, i) => (
                <div key={`empty-${i}`} className="p-4 bg-zinc-950/50 border border-zinc-800/50 border-dashed rounded-2xl flex items-center justify-center">
                  <p className="text-zinc-600 text-sm italic">Waiting for player...</p>
                </div>
              ))}
            </div>
          </div>

          {isHost && (
            <button
              onClick={startGame}
              disabled={!canStart}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
            >
              <Play className="w-5 h-5 fill-current" />
              Start Match
            </button>
          )}
          {!isHost && (
            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
              <p className="text-sm text-emerald-500/80">Waiting for host to start the game...</p>
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4">Invite Friends</h2>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">Share this code with your friends to let them join this room.</p>
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 flex flex-col items-center gap-4">
              <span className="text-4xl font-black tracking-[0.2em] font-mono text-emerald-500">{code}</span>
              <button 
                onClick={copyCode}
                className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl transition-colors text-sm font-medium"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy Code'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
