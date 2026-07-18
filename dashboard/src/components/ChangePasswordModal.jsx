import React, { useState } from 'react';
// Modals must portal to <body>: the glass panel's backdrop-filter makes it the
// containing block for position:fixed, which strands overlays mid-page on mobile.
import { createPortal } from 'react-dom';
import { API_BASE } from '../api';
import { withAuth } from '../auth';
import Icon from '../ui/icons';

// Any logged-in user changes their OWN password (confirms current first).
const ChangePasswordModal = ({ onClose }) => {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async () => {
    if (nw !== nw2) { setMsg('New passwords do not match.'); return; }
    if (nw.length < 4) { setMsg('New password too short.'); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ current_password: cur, new_password: nw }),
      });
      if (res.ok) { setMsg('✓ Password changed.'); setTimeout(onClose, 900); }
      else { const e = await res.json().catch(() => ({})); setMsg(e.detail || 'Failed.'); }
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="sourcing-modal-overlay" onClick={onClose}>
      <div className="sourcing-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title"><h2><Icon name="key" size={18} /> Change Password</h2></div>
        <div className="fin-form">
          <div className="fin-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label>Current password<input type="password" value={cur} onChange={e => setCur(e.target.value)} /></label>
            <label>New password<input type="password" value={nw} onChange={e => setNw(e.target.value)} /></label>
            <label>Confirm new password<input type="password" value={nw2} onChange={e => setNw2(e.target.value)} /></label>
          </div>
          {msg && <div className="fin-preview" style={{ marginTop: 12 }}>{msg}</div>}
          <button className="login-btn" style={{ marginTop: 16 }} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ChangePasswordModal;
