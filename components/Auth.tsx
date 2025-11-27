import React, { useState } from 'react';
import { User, UserMode } from '../types';
import { Cpu, Zap, AlertCircle } from 'lucide-react';

interface AuthProps {
  onLogin: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true); // Toggle Login vs Register
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setError('');
    setLoading(true);

    // Simulate Database + Network Delay
    setTimeout(() => {
      const dbString = localStorage.getItem('gridsync_db');
      const db: Record<string, User> = dbString ? JSON.parse(dbString) : {};

      if (isLogin) {
        // LOGIN LOGIC
        if (db[username]) {
          // User exists, login with saved stats
          const existingUser = db[username];
          // Reset runtime stats but keep points
          const sessionUser: User = {
             ...existingUser,
             id: existingUser.id,
             mode: UserMode.IDLE, // Default to IDLE on login
             cpuUsage: 10,
             memoryUsage: 20,
             isLocal: false // Now remote
          };
          onLogin(sessionUser);
        } else {
          setError(`Node '${username}' not found. Please Register first.`);
          setLoading(false);
        }
      } else {
        // REGISTER LOGIC
        if (db[username]) {
          setError(`Node '${username}' already registered. Please Login.`);
          setLoading(false);
        } else {
          // New User - Ensure Random ID to prevent collision on public MQTT
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          const newUser: User = {
            id: `node-${Date.now()}-${randomSuffix}`,
            username: username,
            points: 0, // NEW NODES START AT 0
            mode: UserMode.IDLE,
            cpuUsage: 12,
            memoryUsage: 24,
            isLocal: false,
          };
          
          // Save to DB
          db[username] = newUser;
          localStorage.setItem('gridsync_db', JSON.stringify(db));
          
          onLogin(newUser);
        }
      }
    }, 1000);
  };

  return (
    <div className="flex items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md p-8 bg-slate-900/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-500/20 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent"></div>
        
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-cyan-500/10 rounded-full mb-4 border border-cyan-500/50">
            <Cpu className="w-10 h-10 text-cyan-400" />
          </div>
          <h1 className="text-3xl font-bold font-mono tracking-tighter text-white">Grid<span className="text-cyan-400">Sync</span></h1>
          <p className="text-slate-400 mt-2 text-center text-sm">
            Decentralized Computational Resource Sharing
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex bg-slate-800 rounded-lg p-1 mb-6">
            <button
                type="button"
                onClick={() => { setIsLogin(true); setError(''); }}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${isLogin ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
                CONNECT (LOGIN)
            </button>
            <button
                type="button"
                onClick={() => { setIsLogin(false); setError(''); }}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${!isLogin ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
                REGISTER NODE
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 font-mono">
              SYSTEM_ID
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all font-mono placeholder-slate-600"
              placeholder="e.g. Node_Alpha_01"
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-500/30">
                <AlertCircle className="w-4 h-4" />
                {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full font-bold py-3 px-4 rounded-lg transition-all duration-300 flex items-center justify-center gap-2 group shadow-lg ${
                isLogin ? 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/20' : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20'
            }`}
          >
            {loading ? (
              <span className="animate-pulse">Handshaking...</span>
            ) : (
              <>
                <Zap className="w-5 h-5 group-hover:scale-110 transition-transform" />
                {isLogin ? 'AUTHENTICATE & JOIN' : 'INITIALIZE NEW NODE'}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Auth;