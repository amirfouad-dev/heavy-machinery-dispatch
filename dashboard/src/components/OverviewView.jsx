import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../api';
import { withAuth } from '../auth';
import { computeProfitBoard, computeFunnel, fmtEgp, parseUTC, relativeTime } from '../analytics';
import Icon from '../ui/icons';
import EmptyState from '../ui/EmptyState';

// Manager "home" — the business at a glance, built for checking from a phone.
// Read-only: big tiles + who-owes-you (tap to call) + a recent activity feed.
// Every number matches the Finance/Reports pages (same helpers, one source).

const OverviewView = ({ listings }) => {
  const [deals, setDeals] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    const get = (path) => fetch(`${API_BASE}${path}`, { headers: withAuth() }).then(r => r.ok ? r.json() : {});
    get('/finance').then(d => setDeals(d.deals || []));
    get('/expenses').then(d => setExpenses(d.expenses || []));
    get('/activity').then(d => setActivity(d.activity || []));
  }, []);

  const board = useMemo(() => computeProfitBoard(deals, expenses), [deals, expenses]);
  const funnel = useMemo(() => computeFunnel(listings || []), [listings]);

  // Who owes you: sold deals with an outstanding balance, biggest first.
  const owes = useMemo(() => deals
    .filter(d => (d.balance || 0) > 0 && d.buyer_name)
    .map(d => ({ name: d.buyer_name, phone: d.buyer_phone, balance: d.balance, machine: `${d.make} ${d.model}` }))
    .sort((a, b) => b.balance - a.balance), [deals]);

  // New machines discovered today (from the shared listings feed).
  const newToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (listings || []).filter(l => {
      const d = parseUTC(l.timestamp);
      return d && d.toISOString().slice(0, 10) === today;
    }).length;
  }, [listings]);

  const agingCount = deals.filter(d => d.finance && d.finance.total_cost_egp &&
    ['Shipping', 'Customs', 'In Stock'].includes(d.status)).length; // stock count; aging detail on Stock page

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>OVERVIEW</h2>
        <p>Your business at a glance.</p>
      </div>

      {/* Money row */}
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-title">COMPANY NET</div>
          <div className="kpi-value" style={{ color: board.companyNet >= 0 ? '#39ff14' : '#ff5c7a' }}>{fmtEgp(board.companyNet)}</div>
          <div className="kpi-note">profit − expenses</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">CASH COLLECTED</div>
          <div className="kpi-value">{fmtEgp(board.collected)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">OWED TO YOU</div>
          <div className="kpi-value" style={{ color: board.outstanding > 0 ? '#ffb300' : '#39ff14' }}>{fmtEgp(board.outstanding)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">CAPITAL TIED UP</div>
          <div className="kpi-value">{fmtEgp(board.capitalTiedUp)}</div>
        </div>
      </div>

      {/* Pipeline row */}
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-title">OPEN DEALS</div>
          <div className="kpi-value">{funnel.open}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">CLOSE RATE</div>
          <div className="kpi-value">{funnel.closeRate === null ? '—' : `${funnel.closeRate}%`}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">IN STOCK</div>
          <div className="kpi-value">{agingCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">NEW TODAY</div>
          <div className="kpi-value" style={{ color: newToday > 0 ? '#00e5ff' : '#fff' }}>{newToday}</div>
        </div>
      </div>

      <div className="charts-grid">
        {/* Who owes you — tap to call */}
        <div className="chart-container">
          <h3><Icon name="money" size={16} /> WHO OWES YOU</h3>
          {owes.length === 0 && <EmptyState compact icon="check" title="All collected" hint="Nobody owes money right now." />}
          {owes.map((o, i) => (
            <a key={i} className="owes-row" href={o.phone ? `tel:${o.phone}` : undefined}>
              <div className="owes-name">
                {o.name}
                <span className="owes-machine">{o.machine}</span>
              </div>
              <div className="owes-right">
                <span className="owes-amount">{fmtEgp(o.balance)}</span>
                {o.phone && <span className="owes-call"><Icon name="phone" size={12} /> {o.phone}</span>}
              </div>
            </a>
          ))}
        </div>

        {/* Recent activity */}
        <div className="chart-container">
          <h3><Icon name="clock" size={16} /> RECENT ACTIVITY</h3>
          {activity.length === 0 && <EmptyState compact icon="clock" title="No recent activity" hint="Status changes and payments show up here." />}
          {activity.map((a, i) => (
            <div key={i} className="activity-row">
              <span className="activity-icon"><Icon name={a.type === 'payment' ? 'payment' : 'refresh'} size={15} /></span>
              <div className="activity-text">
                {a.text}
                {a.amount_egp ? <b> · {fmtEgp(a.amount_egp)}</b> : ''}
                {a.who ? <span className="activity-who"> by {a.who}</span> : ''}
              </div>
              <span className="activity-time">{relativeTime(parseUTC(a.ts))}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OverviewView;
