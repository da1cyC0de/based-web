import React, { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import Browser from './components/Browser';
import './App.css';

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setAuthenticated(data.authenticated);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  }

  return <Browser onLogout={() => setAuthenticated(false)} />;
}

export default App;
