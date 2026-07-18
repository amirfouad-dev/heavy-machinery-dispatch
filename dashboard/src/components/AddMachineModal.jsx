import React, { useState } from 'react';
// Modals must portal to <body>: the glass panel's backdrop-filter makes it the
// containing block for position:fixed, which strands overlays mid-page on mobile.
import { createPortal } from 'react-dom';
import { API_BASE } from '../api';
import { withAuth } from '../auth';
import { PIPELINE_STAGES } from '../analytics';
import Icon from '../ui/icons';
import { toast } from '../ui/feedback';

// Add a deal heard by phone/email (not scraped). It flows through the same
// pipeline + finance as any scraped listing. Available to any logged-in user.

const CATEGORIES = [
  ['', '—'], ['wheel_loader', 'Wheel Loader'], ['excavator', 'Excavator'], ['dump_truck', 'Dump Truck'],
];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'EGP'];
const START_STAGES = ['Active', 'Contacted', 'Negotiating', 'Purchased'];

const EMPTY = {
  make: '', model: '', year: '', category: '', price: '', currency: 'USD',
  location: '', country: '', seller_name: '', seller_phone: '', notes: '',
  initial_status: 'Active',
};

const AddMachineModal = ({ onClose, onAdded }) => {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!f.make.trim() || !f.model.trim()) { toast.error('Make and model are required.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/listings/manual`, {
        method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...f,
          year: f.year ? Number(f.year) : null,
          // Store the price with its currency so it reads like scraped listings.
          price: f.price ? `${f.currency} ${f.price}` : null,
          category: f.category || null,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast.error(`Failed: ${e.detail || res.status}`); return; }
      toast.success(`${f.make} ${f.model} added.`);
      onAdded();
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="sourcing-modal-overlay" onClick={onClose}>
      <div className="sourcing-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title"><h2><Icon name="plus" size={19} /> Add a Machine</h2></div>

        <div className="fin-form">
          <h3>MACHINE</h3>
          <div className="fin-grid">
            <label>Make *<input value={f.make} onChange={e => set('make', e.target.value)} placeholder="CAT / Doosan…" /></label>
            <label>Model *<input value={f.model} onChange={e => set('model', e.target.value)} placeholder="980H, DX300LC…" /></label>
            <label>Year<input type="number" value={f.year} onChange={e => set('year', e.target.value)} /></label>
            <label>Category
              <select value={f.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            <label>Price
              <input type="number" value={f.price} onChange={e => set('price', e.target.value)} /></label>
            <label>Currency
              <select value={f.currency} onChange={e => set('currency', e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select></label>
          </div>

          <h3>LOCATION &amp; SELLER</h3>
          <div className="fin-grid">
            <label>Location<input value={f.location} onChange={e => set('location', e.target.value)} placeholder="City, Country" /></label>
            <label>Country<input value={f.country} onChange={e => set('country', e.target.value)} /></label>
            <label>Seller name<input value={f.seller_name} onChange={e => set('seller_name', e.target.value)} /></label>
            <label>Seller phone<input value={f.seller_phone} onChange={e => set('seller_phone', e.target.value)} /></label>
          </div>

          <h3>STATUS</h3>
          <div className="fin-grid">
            <label>Starting stage
              <select value={f.initial_status} onChange={e => set('initial_status', e.target.value)}>
                {START_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select></label>
            <label>Notes<input value={f.notes} onChange={e => set('notes', e.target.value)} /></label>
          </div>

          <button className="login-btn" style={{ marginTop: 16 }} onClick={save} disabled={busy}>
            {busy ? 'Adding…' : 'Add machine'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AddMachineModal;
