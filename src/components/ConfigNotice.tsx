import React from 'react';
import { AlertCircle, ExternalLink, Settings } from 'lucide-react';

export default function ConfigNotice() {
  return (
    <div className="fixed bottom-6 left-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-2xl mx-auto bg-zinc-900 border border-amber-500/30 rounded-2xl p-6 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="flex gap-4">
          <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center shrink-0 border border-amber-500/20">
            <AlertCircle className="w-6 h-6 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-zinc-100 mb-1">Supabase Setup Required</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              The application is currently running in <span className="text-amber-500 font-semibold">Demo Mode</span> because Supabase credentials are missing. Real-time multiplayer and persistent accounts will not work until configured.
            </p>
            
            <div className="flex flex-wrap gap-3">
              <a 
                href="https://supabase.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-semibold transition-colors border border-zinc-700"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Get Supabase Keys
              </a>
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 rounded-lg text-xs font-semibold text-amber-500 border border-amber-500/20">
                <Settings className="w-3.5 h-3.5" />
                Add to Environment Variables
              </div>
            </div>
          </div>
        </div>
        
        <div className="mt-6 pt-6 border-t border-zinc-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Variable Name</p>
            <code className="text-xs bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-emerald-500">VITE_SUPABASE_URL</code>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Variable Name</p>
            <code className="text-xs bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-emerald-500">VITE_SUPABASE_ANON_KEY</code>
          </div>
        </div>
      </div>
    </div>
  );
}
