import React, { useState } from 'react';

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (res.ok) onLogin();
      else { setError('Wrong password'); setPassword(''); }
    } catch { setError('Connection failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Web Browser</h1>
        <p>Enter password to access</p>
        <form onSubmit={handleSubmit}>
          <input type="password" className="login-input" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} autoFocus disabled={loading} />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-btn" disabled={loading || !password}>
            {loading ? '...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginScreen;
