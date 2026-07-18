import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE } from '../api';
import { withAuth } from '../auth';
import { fmtEgp } from '../analytics';
import Icon from '../ui/icons';
import EmptyState from '../ui/EmptyState';
import { dialogs, toast } from '../ui/feedback';

// Manager-only mini-CRM: each buyer, their contact, what they bought, and what
// they still owe across ALL their deals (aggregated from /finance).

const BuyersView = () => {
  const [buyers, setBuyers] = useState([]);
  const [deals, setDeals] = useState([]);

  const loadBuyers = useCallback(() =>
    fetch(`${API_BASE}/buyers`, { headers: withAuth() }).then(r => r.json()).then(d => setBuyers(d.buyers || [])).catch(() => {}), []);
  const loadDeals = useCallback(() =>
    fetch(`${API_BASE}/finance`, { headers: withAuth() }).then(r => r.json()).then(d => setDeals(d.deals || [])).catch(() => {}), []);
  useEffect(() => { loadBuyers(); loadDeals(); }, [loadBuyers, loadDeals]);

  // Roll deals up per buyer_id.
  const rows = useMemo(() => {
    const byId = {};
    for (const b of buyers) byId[b.id] = { ...b, deals: 0, spent: 0, owed: 0 };
    for (const d of deals) {
      if (!d.buyer_id || !byId[d.buyer_id]) continue;
      const agg = byId[d.buyer_id];
      agg.deals += 1;
      agg.spent += (d.finance && d.finance.sale_price_egp) || 0;
      if (d.balance && d.balance > 0) agg.owed += d.balance;
    }
    return Object.values(byId).sort((a, b) => b.owed - a.owed || b.spent - a.spent);
  }, [buyers, deals]);

  const addBuyer = async () => {
    const name = await dialogs.prompt({ title: 'Add buyer', message: "Buyer's name", placeholder: 'Full name' });
    if (!name) return;
    const phone = (await dialogs.prompt({ title: 'Add buyer', message: 'Phone (optional)', placeholder: 'Phone number' })) || null;
    const company = (await dialogs.prompt({ title: 'Add buyer', message: 'Company (optional)', placeholder: 'Company' })) || null;
    try {
      const res = await fetch(`${API_BASE}/buyers`, {
        method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name, phone, company }),
      });
      if (res.ok) { toast.success(`Buyer “${name}” added.`); loadBuyers(); }
      else toast.error('Failed to add buyer.');
    } catch { toast.error("Couldn't reach the server."); }
  };

  const totalOwed = rows.reduce((a, r) => a + r.owed, 0);

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>BUYERS · CRM</h2>
        <p>Your customers, what they bought, and what they still owe. Manager only.</p>
      </div>

      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-title">BUYERS</div><div className="kpi-value">{buyers.length}</div></div>
        <div className="kpi-card"><div className="kpi-title">TOTAL OUTSTANDING</div><div className="kpi-value" style={{ color: totalOwed > 0 ? '#ffb300' : '#39ff14' }}>{fmtEgp(totalOwed)}</div></div>
      </div>

      <div className="widget table-widget" style={{ flex: 1, minHeight: 0 }}>
        <div className="widget-header">
          BUYERS
          <button className="btn-action" style={{ float: 'right' }} onClick={addBuyer}><Icon name="plus" size={14} />Add buyer</button>
        </div>
        <div className="table-scroll-container">
          <table className="data-table">
            <thead><tr><th>NAME</th><th>COMPANY</th><th>PHONE</th><th>EMAIL</th><th>DEALS</th><th>PURCHASED</th><th>OWES</th></tr></thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong></td>
                  <td>{b.company || '—'}</td>
                  <td>{b.phone ? <a href={`tel:${b.phone}`}>{b.phone}</a> : '—'}</td>
                  <td>{b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : '—'}</td>
                  <td>{b.deals}</td>
                  <td>{fmtEgp(b.spent)}</td>
                  <td>{b.owed > 0 ? <b className="neg">{fmtEgp(b.owed)}</b> : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="7">
                <EmptyState icon="handshake" title="No buyers yet"
                  hint="Add a buyer here, or pick one when recording a sale in Finance." />
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BuyersView;
