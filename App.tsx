import React, { useState, useEffect } from 'react';
import AnimatedBackground from './components/AnimatedBackground';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import { User } from './types';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);

  // Load user from local storage on mount (simple persistence)
  useEffect(() => {
    const storedUser = localStorage.getItem('gridsync_user');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        console.error("Failed to parse user session");
      }
    }
  }, []);

  const handleLogin = (userData: User) => {
    setUser(userData);
    localStorage.setItem('gridsync_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('gridsync_user');
  };

  const handleUpdatePoints = (pointsToAdd: number) => {
      if (!user) return;
      const updatedUser = { ...user, points: user.points + pointsToAdd };
      setUser(updatedUser);
      localStorage.setItem('gridsync_user', JSON.stringify(updatedUser));
  };

  return (
    <div className="relative min-h-screen font-sans text-slate-200">
      <AnimatedBackground />
      
      <main className="relative z-10">
        {!user ? (
          <Auth onLogin={handleLogin} />
        ) : (
          <Dashboard 
            user={user} 
            onLogout={handleLogout} 
            onUpdatePoints={handleUpdatePoints}
          />
        )}
      </main>
    </div>
  );
};

export default App;