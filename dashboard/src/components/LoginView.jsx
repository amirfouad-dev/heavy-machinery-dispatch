import React, { useState } from 'react';
import { login } from '../auth';
import Icon from '../ui/icons';

// Full-screen gate shown until a valid session exists.
const LoginView = ({ onSuccess }) => {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await login(name.trim(), password);
      onSuccess(data);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="hex-bg"></div>
      <div className="bg-flares"></div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo"><Icon name="globe" size={44} /></div>
        <h1 className="login-title">HEAVY MACHINERY DISPATCH</h1>
        <p className="login-sub">Global Dispatch Center — sign in</p>

        <label className="login-label">Name</label>
        <input
          className="login-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          autoComplete="username"
        />

        <label className="login-label">Password</label>
        <input
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn" type="submit" disabled={busy || !name || !password}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
};

export default LoginView;
