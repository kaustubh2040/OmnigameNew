import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Match, RoomPlayer } from '../types/game';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, ArrowLeft, Loader2, RefreshCw, Gamepad2, Sparkles, AlertCircle, XCircle } from 'lucide-react';

export default function MatchPage() {
  const { roomId } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [match, setMatch] = useState<Match | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [xpChange, setXpChange] = useState<number | null>(null);
  const [progressionProcessed, setProgressionProcessed] = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [opponentLeft, setOpponentLeft] = useState(false);
  
  const presenceChannelRef = useRef<any>(null);

  useEffect(() => {
    if (!roomId || !profile) return;
    fetchMatchData();

    // Match real-time sync
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
          fetchPlayers();
        }
      )
      .subscribe();

    // Presence detection
    const presenceChannel = supabase.channel(`presence:${roomId}`, {
      config: {
        presence: {
          key: profile.user_id,
        },
      },
    });

    presenceChannelRef.current = presenceChannel;

    presenceChannel
      .on('presence' as any, { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const onlineUserIds = Object.keys(state);
        
        // If we have match data and players, check if opponent is still here
        if (players.length === 2) {
          const opponent = players.find(p => p.user_id !== profile.user_id);
          if (opponent && !onlineUserIds.includes(opponent.user_id)) {
            // Opponent left!
            handleOpponentLeft();
          }
        }
      })
      .on('presence' as any, { event: 'join', key: profile.user_id }, () => {
        console.log('Joined presence');
      })
      .on('presence' as any, { event: 'leave', key: profile.user_id }, () => {
        console.log('Left presence');
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: profile.user_id,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
      if (presenceChannelRef.current) {
        supabase.removeChannel(presenceChannelRef.current);
      }
    };
  }, [roomId, profile?.user_id]);

  const handleOpponentLeft = async () => {
    if (!match || match.status !== 'active' || opponentLeft) return;
    setOpponentLeft(true);

    // If opponent leaves, current player wins
    try {
      const { error: updateError } = await supabase
        .from('matches')
        .update({
          status: 'completed',
          winner: profile?.user_id,
          game_state: {
            ...match.game_state,
            winner: players.find(p => p.user_id === profile?.user_id)?.symbol,
            reason: 'opponent_left'
          }
        })
        .eq('match_id', match.match_id);

      if (updateError) throw updateError;
    } catch (err) {
      console.error('Error handling opponent departure:', err);
    }
  };

  const handleExitMatch = async () => {
    if (!match || !profile) return;
    
    if (match.status === 'active') {
      // Penalty for leaving active match
      try {
        const opponent = players.find(p => p.user_id !== profile.user_id);
        const { error: updateError } = await supabase
          .from('matches')
          .update({
            status: 'completed',
            winner: opponent?.user_id,
            game_state: {
              ...match.game_state,
              winner: opponent?.symbol,
              reason: 'player_quit',
              quitter: profile.user_id
            }
          })
          .eq('match_id', match.match_id);

        if (updateError) throw updateError;
      } catch (err) {
        console.error('Error exiting match:', err);
      }
    }
    
    navigate('/dashboard');
  };

  useEffect(() => {
    if (match && (match.status === 'completed' || match.status === 'draw') && !progressionProcessed && profile) {
      handleProgression();
    }
  }, [match?.status, profile, progressionProcessed]);

  async function handleProgression() {
    if (!match || !profile || progressionProcessed) return;
    setProgressionProcessed(true);

    const isWinner = match.winner === profile.user_id;
    const isDraw = match.status === 'draw';
    const isQuitter = match.game_state.reason === 'player_quit' && match.game_state.quitter === profile.user_id;
    
    let gainedXp = 0;
    if (isQuitter) {
      gainedXp = -10;
    } else if (isDraw) {
      gainedXp = 20;
    } else if (isWinner) {
      gainedXp = 50;
    } else {
      gainedXp = -5; // Loser penalty
    }

    if (!isSupabaseConfigured) {
      setXpChange(gainedXp);
      return;
    }
    
    try {
      // 1. Fetch current levels config
      const { data: levels } = await supabase
        .from('xp_levels')
        .select('*')
        .order('level', { ascending: true });

      if (!levels) return;

      const newTotalXp = Math.max(0, (profile.xp || 0) + gainedXp);
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
            xp: Math.max(0, leaderboardEntry.xp + gainedXp)
          })
          .eq('user_id', profile.user_id);
      } else {
        await supabase
          .from('leaderboard')
          .insert({
            user_id: profile.user_id,
            wins: isWinner ? 1 : 0,
            losses: !isWinner && !isDraw ? 1 : 0,
            xp: Math.max(0, gainedXp)
          });
      }

      setXpChange(gainedXp);
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

    if (board.every(cell => cell !== null && cell !== "")) return 'draw';
    return null;
  };

  const handleTileClick = async (index: number) => {
    if (!match || match.status !== 'active' || !profile) return;
    
    const { board, turn } = match.game_state;
    if (turn !== profile.user_id) return;
    if (board![index] !== null && board![index] !== "") return;

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

  const board = match.game_state.board || Array(9).fill("");
  const isMyTurn = match.game_state.turn === profile?.user_id;
  const winner = match.game_state.winner;
  const mySymbol = players.find(p => p.user_id === profile?.user_id)?.symbol;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 min-h-screen flex flex-col">
      <header className="flex items-center justify-between mb-6 sm:mb-8">
        <button 
          onClick={() => setShowExitConfirm(true)}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-100 transition-colors p-2 -ml-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Quit Match</span>
        </button>
        <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 px-3 py-1.5 sm:px-4 sm:py-2 rounded-2xl">
          <Gamepad2 className="w-4 h-4 text-emerald-500" />
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest">Tic Tac Toe</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 sm:gap-12">
        {/* Players Info */}
        <div className="w-full flex items-center justify-between gap-4 max-w-md">
          {players.map((player) => (
            <div 
              key={player.user_id}
              className={`flex flex-col items-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-2xl border transition-all flex-1 ${
                match.game_state.turn === player.user_id 
                  ? 'bg-emerald-500/10 border-emerald-500 shadow-lg shadow-emerald-500/10 scale-105' 
                  : 'bg-zinc-900 border-zinc-800 opacity-50'
              }`}
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-zinc-950 flex items-center justify-center border border-zinc-800 relative">
                <span className="text-lg sm:text-xl font-bold text-emerald-500">{player.symbol}</span>
                {match.game_state.turn === player.user_id && (
                  <motion.div 
                    layoutId="turn-indicator"
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-emerald-500 rounded-full border-2 border-zinc-950"
                  />
                )}
              </div>
              <div className="text-center overflow-hidden w-full">
                <p className="text-xs sm:text-sm font-bold truncate">{player.users?.username}</p>
                <p className="text-[8px] sm:text-[10px] text-zinc-500 uppercase font-black">Level {player.users?.level}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Game Board */}
        <div className="relative">
          <div className="grid grid-cols-3 gap-2 sm:gap-3 bg-zinc-800 p-2 sm:p-3 rounded-3xl shadow-2xl">
            {board.map((cell, i) => (
              <button
                key={i}
                onClick={() => handleTileClick(i)}
                disabled={!isMyTurn || (cell !== null && cell !== "") || !!winner}
                className={`w-20 h-20 sm:w-32 sm:h-32 rounded-2xl bg-zinc-950 flex items-center justify-center text-3xl sm:text-6xl font-black transition-all border-2 ${
                  cell === 'X' ? 'text-emerald-500 border-emerald-500/20 shadow-[inset_0_0_20px_rgba(16,185,129,0.1)]' : 
                  cell === 'O' ? 'text-amber-500 border-amber-500/20 shadow-[inset_0_0_20px_rgba(245,158,11,0.1)]' : 
                  isMyTurn && !winner ? 'hover:bg-zinc-900 border-zinc-800 cursor-pointer active:scale-95' : 'border-transparent cursor-default'
                }`}
              >
                <AnimatePresence mode="wait">
                  {cell && (
                    <motion.span
                      initial={{ scale: 0, rotate: -45, opacity: 0 }}
                      animate={{ scale: 1, rotate: 0, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
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
                initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
                animate={{ opacity: 1, backdropFilter: "blur(4px)" }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/60 rounded-3xl"
              >
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="bg-zinc-900 p-6 sm:p-8 rounded-3xl border border-zinc-800 shadow-2xl text-center w-[90%] max-w-xs"
                >
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 border ${
                    winner === 'draw' ? 'bg-zinc-500/10 border-zinc-500/20' : 
                    winner === mySymbol ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
                  }`}>
                    {winner === 'draw' ? <RefreshCw className="w-8 h-8 text-zinc-500" /> : 
                     winner === mySymbol ? <Trophy className="w-8 h-8 text-emerald-500" /> : <XCircle className="w-8 h-8 text-red-500" />}
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black mb-1">
                    {winner === 'draw' ? "🤝 DRAW" : winner === mySymbol ? "🏆 YOU WIN!" : "💔 YOU LOST"}
                  </h2>
                  <p className="text-zinc-500 text-xs sm:text-sm mb-6">
                    {match.game_state.reason === 'opponent_left' ? "Opponent disconnected" :
                     winner === 'draw' ? "Well played by both!" : 
                     winner === mySymbol ? "Victory is yours!" : "Better luck next time!"}
                  </p>

                  <AnimatePresence>
                    {xpChange !== null && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex items-center justify-center gap-2 mb-6 py-2 px-4 rounded-xl border ${
                          xpChange > 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-red-500/10 border-red-500/20 text-red-500'
                        }`}
                      >
                        <Sparkles className="w-4 h-4" />
                        <span className="text-sm font-bold uppercase tracking-wider">
                          {xpChange > 0 ? `+${xpChange}` : xpChange} XP
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={handleRematch}
                      disabled={rematchLoading || players.length < 2 || match.game_state.rematch_requests?.includes(profile?.user_id || '')}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-950 font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                    >
                      {rematchLoading || match.game_state.rematch_requests?.includes(profile?.user_id || '') ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {match.game_state.rematch_requests?.length === 1 ? 'Waiting...' : 'Starting...'}
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
                      className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold py-3 px-6 rounded-xl transition-all text-sm"
                    >
                      Exit to Lobby
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Turn Indicator */}
        {!winner && (
          <div className="flex flex-col items-center gap-2">
            <div className={`px-6 py-2 rounded-full border text-[10px] sm:text-xs font-bold tracking-widest uppercase transition-all ${
              isMyTurn ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-zinc-900 border-zinc-800 text-zinc-500'
            }`}>
              {isMyTurn ? "Your Turn" : "Opponent's Turn"}
            </div>
            <p className="text-[10px] text-zinc-600">You are playing as <span className="font-bold text-zinc-400">{mySymbol}</span></p>
          </div>
        )}
      </div>

      {/* Exit Confirmation Dialog */}
      <AnimatePresence>
        {showExitConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl max-w-xs w-full shadow-2xl"
            >
              <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mb-4 border border-red-500/20">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-lg font-bold mb-2">Quit Match?</h3>
              <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
                Quitting an active match will count as a loss and result in a <span className="text-red-500 font-bold">-10 XP penalty</span>.
              </p>
              <div className="flex flex-col gap-2">
                <button 
                  onClick={handleExitMatch}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl transition-all text-sm"
                >
                  Yes, Quit
                </button>
                <button 
                  onClick={() => setShowExitConfirm(false)}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold py-2.5 rounded-xl transition-all text-sm"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
