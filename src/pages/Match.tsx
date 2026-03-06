import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Match, RoomPlayer } from '../types/game';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowLeft, Loader2, RefreshCw, Gamepad2, Sparkles } from 'lucide-react';

export default function MatchPage() {
  const { roomId } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [match, setMatch] = useState<Match | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [xpGained, setXpGained] = useState<number | null>(null);
  const [progressionProcessed, setProgressionProcessed] = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    fetchMatchData();

    const channel = supabase
      .channel(`match:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `match_id=eq.${roomId}`,
        },
        (payload) => {
          const updatedMatch = payload.new as Match;
          setMatch(updatedMatch);

          // Check for rematch redirect
          if (updatedMatch.game_state.next_match_id) {
            navigate(`/match/${updatedMatch.game_state.next_match_id}`);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
        },
        () => {
          // Re-fetch players if anyone joins or leaves
          fetchPlayers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    if (match && (match.status === 'completed' || match.status === 'draw') && !progressionProcessed && profile) {
      handleProgression();
    }
  }, [match?.status, profile, progressionProcessed]);

  async function handleProgression() {
    if (!match || !profile || progressionProcessed) return;
    setProgressionProcessed(true);

    if (!isSupabaseConfigured) {
      // Mock progression for demo mode
      const isWinner = match.winner === profile.user_id;
      const isDraw = match.status === 'draw';
      const gained = isDraw ? 20 : isWinner ? 50 : 10;
      setXpGained(gained);
      return;
    }

    const isWinner = match.winner === profile.user_id;
    const isDraw = match.status === 'draw';
    const gainedXp = isDraw ? 20 : isWinner ? 50 : 10;
    
    try {
      // 1. Fetch current levels config
      const { data: levels } = await supabase
        .from('xp_levels')
        .select('*')
        .order('level', { ascending: true });

      if (!levels) return;

      const newTotalXp = (profile.xp || 0) + gainedXp;
      let newLevel = profile.level || 1;

      // 2. Determine new level
      for (const levelConfig of levels) {
        if (newTotalXp >= levelConfig.xp_required) {
          newLevel = levelConfig.level;
        } else {
          break;
        }
      }

      // 3. Update user profile
      await supabase
        .from('users')
        .update({
          xp: newTotalXp,
          level: newLevel
        })
        .eq('user_id', profile.user_id);

      // 4. Update leaderboard
      const { data: leaderboardEntry } = await supabase
        .from('leaderboard')
        .select('*')
        .eq('user_id', profile.user_id)
        .single();

      if (leaderboardEntry) {
        await supabase
          .from('leaderboard')
          .update({
            wins: leaderboardEntry.wins + (isWinner ? 1 : 0),
            losses: leaderboardEntry.losses + (!isWinner && !isDraw ? 1 : 0),
            xp: leaderboardEntry.xp + gainedXp
          })
          .eq('user_id', profile.user_id);
      } else {
        await supabase
          .from('leaderboard')
          .insert({
            user_id: profile.user_id,
            wins: isWinner ? 1 : 0,
            losses: !isWinner && !isDraw ? 1 : 0,
            xp: gainedXp
          });
      }

      setXpGained(gainedXp);
    } catch (err) {
      console.error('Error processing progression:', err);
    }
  }

  const handleRematch = async () => {
    if (!match || !profile || players.length < 2) return;
    setRematchLoading(true);

    if (!isSupabaseConfigured) {
      // Mock rematch for demo mode
      setTimeout(() => {
        navigate('/dashboard'); // Just go back in demo
      }, 1000);
      return;
    }

    const currentRequests = match.game_state.rematch_requests || [];
    if (currentRequests.includes(profile.user_id)) return;

    const newRequests = [...currentRequests, profile.user_id];
    
    try {
      if (newRequests.length === 2) {
        // Both players agreed, create new match
        const initialState = {
          board: Array(9).fill(null),
          turn: match.room_id, // This is a bit tricky, let's use the previous winner or host
          winner: null,
          rematch_requests: []
        };

        // Determine who starts - alternate from previous match or winner starts
        const nextTurn = match.winner || match.game_state.turn || players[0].user_id;

        const { data: newMatch, error: createError } = await supabase
          .from('matches')
          .insert({
            room_id: match.room_id,
            game_state: { ...initialState, turn: nextTurn },
            current_turn: nextTurn,
            status: 'active'
          })
          .select()
          .single();

        if (createError) throw createError;

        // Update current match with next_match_id to trigger redirect for both
        await supabase
          .from('matches')
          .update({
            game_state: {
              ...match.game_state,
              rematch_requests: newRequests,
              next_match_id: newMatch.match_id
            }
          })
          .eq('match_id', match.match_id);
      } else {
        // Just update requests
        await supabase
          .from('matches')
          .update({
            game_state: {
              ...match.game_state,
              rematch_requests: newRequests
            }
          })
          .eq('match_id', match.match_id);
      }
    } catch (err) {
      console.error('Error requesting rematch:', err);
      setRematchLoading(false);
    }
  };

  async function fetchMatchData() {
    try {
      const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('match_id', roomId)
        .single();

      if (matchError || !matchData) throw new Error('Match not found');
      setMatch(matchData);

      await fetchPlayers(matchData.room_id);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPlayers(targetRoomId?: string) {
    const id = targetRoomId || match?.room_id;
    if (!id) return;

    try {
      const { data: playerData, error: playerError } = await supabase
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
        .eq('room_id', id);

      if (playerError) throw playerError;
      setPlayers(playerData as any);
    } catch (err) {
      console.error('Error fetching players:', err);
    }
  }

  const checkWinner = (board: (string | null)[]) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
      [0, 4, 8], [2, 4, 6]             // diags
    ];

    for (const [a, b, c] of lines) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }

    if (board.every(cell => cell !== null)) return 'draw';
    return null;
  };

  const handleTileClick = async (index: number) => {
    if (!match || match.status !== 'active' || !profile) return;
    
    const { board, turn } = match.game_state;
    if (turn !== profile.user_id) return;
    if (board![index] !== null) return;

    const currentPlayer = players.find(p => p.user_id === profile.user_id);
    if (!currentPlayer || !currentPlayer.symbol) return;

    const newBoard = [...board!];
    newBoard[index] = currentPlayer.symbol;

    const winnerSymbol = checkWinner(newBoard);
    const nextTurn = players.find(p => p.user_id !== profile.user_id)?.user_id;

    let newStatus: 'active' | 'completed' | 'draw' = 'active';
    let winnerId = null;

    if (winnerSymbol === 'draw') {
      newStatus = 'draw';
    } else if (winnerSymbol) {
      newStatus = 'completed';
      winnerId = profile.user_id;
    }

    const newState = {
      ...match.game_state,
      board: newBoard,
      turn: winnerSymbol ? null : nextTurn,
      winner: winnerSymbol
    };

    try {
      const { error: updateError } = await supabase
        .from('matches')
        .update({
          game_state: newState,
          current_turn: winnerSymbol ? null : nextTurn,
          status: newStatus,
          winner: winnerId
        })
        .eq('match_id', match.match_id);

      if (updateError) throw updateError;
    } catch (err) {
      console.error('Error updating match:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        <p className="text-zinc-500 animate-pulse">Loading match...</p>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-500">{error || 'Match not found'}</p>
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-zinc-400 hover:text-zinc-100">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
      </div>
    );
  }

  const board = match.game_state.board || Array(9).fill(null);
  const isMyTurn = match.game_state.turn === profile?.user_id;
  const winner = match.game_state.winner;
  const mySymbol = players.find(p => p.user_id === profile?.user_id)?.symbol;

  return (
    <div className="max-w-4xl mx-auto p-6 min-h-screen flex flex-col">
      <header className="flex items-center justify-between mb-8">
        <button 
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Quit Match
        </button>
        <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-2xl">
          <Gamepad2 className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-bold uppercase tracking-widest">Tic Tac Toe</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-12">
        {/* Players Info */}
        <div className="w-full flex items-center justify-between gap-4 max-w-md">
          {players.map((player) => (
            <div 
              key={player.user_id}
              className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all ${
                match.game_state.turn === player.user_id 
                  ? 'bg-emerald-500/10 border-emerald-500 shadow-lg shadow-emerald-500/10' 
                  : 'bg-zinc-900 border-zinc-800 opacity-50'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-zinc-950 flex items-center justify-center border border-zinc-800 relative">
                <span className="text-xl font-bold text-emerald-500">{player.symbol}</span>
                {match.game_state.turn === player.user_id && (
                  <motion.div 
                    layoutId="turn-indicator"
                    className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-zinc-950"
                  />
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-bold truncate max-w-[100px]">{player.users?.username}</p>
                <p className="text-[10px] text-zinc-500 uppercase font-black">Level {player.users?.level}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Game Board */}
        <div className="relative">
          <div className="grid grid-cols-3 gap-3 bg-zinc-800 p-3 rounded-3xl shadow-2xl">
            {board.map((cell, i) => (
              <button
                key={i}
                onClick={() => handleTileClick(i)}
                disabled={!isMyTurn || cell !== null || !!winner}
                className={`w-24 h-24 sm:w-32 sm:h-32 rounded-2xl bg-zinc-950 flex items-center justify-center text-4xl sm:text-6xl font-black transition-all border-2 ${
                  cell === 'X' ? 'text-emerald-500 border-emerald-500/20' : 
                  cell === 'O' ? 'text-amber-500 border-amber-500/20' : 
                  isMyTurn && !winner ? 'hover:bg-zinc-900 border-zinc-800 cursor-pointer' : 'border-transparent cursor-default'
                }`}
              >
                <AnimatePresence mode="wait">
                  {cell && (
                    <motion.span
                      initial={{ scale: 0, rotate: -45 }}
                      animate={{ scale: 1, rotate: 0 }}
                      className="block"
                    >
                      {cell}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            ))}
          </div>

          {/* Game Over Overlay */}
          <AnimatePresence>
            {winner && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-sm rounded-3xl border border-emerald-500/20"
              >
                <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 shadow-2xl text-center">
                  <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                    <Trophy className="w-8 h-8 text-emerald-500" />
                  </div>
                  <h2 className="text-2xl font-black mb-2">
                    {winner === 'draw' ? "It's a Draw!" : winner === mySymbol ? "You Won!" : "Opponent Won!"}
                  </h2>
                  <p className="text-zinc-500 text-sm mb-4">
                    {winner === 'draw' ? "Well played by both!" : winner === mySymbol ? "Victory is yours!" : "Better luck next time!"}
                  </p>

                  <AnimatePresence>
                    {xpGained !== null && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-center gap-2 mb-6 py-2 px-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl"
                      >
                        <Sparkles className="w-4 h-4 text-emerald-500" />
                        <span className="text-sm font-bold text-emerald-500">+{xpGained} XP GAINED</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={handleRematch}
                      disabled={rematchLoading || players.length < 2 || match.game_state.rematch_requests?.includes(profile?.user_id || '')}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-950 font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      {rematchLoading || match.game_state.rematch_requests?.includes(profile?.user_id || '') ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {match.game_state.rematch_requests?.length === 1 ? 'Waiting for Opponent...' : 'Preparing Rematch...'}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          Rematch
                        </>
                      )}
                    </button>
                    
                    <button 
                      onClick={() => navigate('/dashboard')}
                      className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold py-3 px-6 rounded-xl transition-all"
                    >
                      Return to Dashboard
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Turn Indicator */}
        {!winner && (
          <div className="flex flex-col items-center gap-2">
            <div className={`px-6 py-2 rounded-full border text-sm font-bold tracking-widest uppercase transition-all ${
              isMyTurn ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500' : 'bg-zinc-900 border-zinc-800 text-zinc-500'
            }`}>
              {isMyTurn ? "Your Turn" : "Opponent's Turn"}
            </div>
            <p className="text-xs text-zinc-600">You are playing as <span className="font-bold text-zinc-400">{mySymbol}</span></p>
          </div>
        )}
      </div>
    </div>
  );
}
