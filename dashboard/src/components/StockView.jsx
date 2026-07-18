import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../api';
import { withAuth } from '../auth';
import { fmtEgp } from '../analytics';
import Icon from '../ui/icons';
import EmptyState from '../ui/EmptyState';
import { SkeletonCards } from '../ui/Skeleton';

// "What do I own right now?" — every machine bought but not yet sold, grouped
// by stage, with days-in-stage and aging highlights. Idle machines = idle
// capital, so stuck ones glow red. Manager-only (costs are shown).

const STAGES = ['Purchased', 'Shipping', 'Customs', 'In Stock'];
// Same thresholds as the daily Telegram digest (alerts.py) — keep in sync.
const AGING_DAYS = { Shipping: 45, Customs: 21, 'In Stock': 60 };
const STAGE_ICONS = { Purchased: 'money', Shipping: 'stock', Customs: 'clipboard', 'In Stock': 'home' };

const daysSince = (ts) => {
  if (!ts) return null;
  const d = new Date(String(ts).replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return Math.max(Math.floor((Date.now() - d.getTime()) / 86400000), 0);
};

const StockView = () => {
  const [deals, setDeals] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/finance`, { headers: withAuth() })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => setDeals(d.deals || []))
      .catch(e => setError(e.message));
  }, []);

  const stock = useMemo(() => {
    const owned = (deals || []).filter(d => STAGES.includes(d.status));
    let capital = 0, agingCount = 0;
    const rows = owned.map(d => {
      const days = daysSince(d.status_changed_at);
      const limit = AGING_DAYS[d.status];
      const aging = limit !== undefined && days !== null && days >= limit;
      if (aging) agingCount += 1;
      const cost = d.finance && d.finance.total_cost_egp;
      if (cost) capital += cost;
      return { ...d, days, aging, cost };
    });
    const byStage = STAGES.map(s => ({
      stage: s,
      items: rows.filter(r => r.status === s).sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    }));
    return { rows, byStage, capital, agingCount };
  }, [deals]);

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>STOCK · MACHINES WE OWN</h2>
        <p>Everything purchased and not yet sold — where it is, and how long it's been stuck there.</p>
      </div>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-title">MACHINES IN STOCK</div>
          <div className="kpi-value">{stock.rows.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">CAPITAL TIED UP</div>
          <div className="kpi-value">{fmtEgp(stock.capital)}</div>
          <div className="kpi-note">known costs of unsold machines</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">SITTING TOO LONG</div>
          <div className="kpi-value" style={{ color: stock.agingCount > 0 ? '#ff5c7a' : '#39ff14' }}>
            {stock.agingCount}
          </div>
          <div className="kpi-note">over stage limit — consider action</div>
        </div>
      </div>

      {error && <EmptyState icon="alert" title="Couldn't load stock" hint={error} />}
      {!deals && !error && <SkeletonCards count={4} />}

      {deals && stock.rows.length === 0 && (
        <div className="widget" style={{ padding: 10 }}>
          <EmptyState icon="stock" title="No machines in stock"
            hint='A machine appears here once a deal reaches "Purchased".' />
        </div>
      )}

      {stock.byStage.map(({ stage, items }) => items.length > 0 && (
        <div className="widget table-widget" key={stage} style={{ marginBottom: 18 }}>
          <div className="widget-header">
            <Icon name={STAGE_ICONS[stage]} size={15} /> {stage.toUpperCase()} — {items.length}
            {AGING_DAYS[stage] !== undefined && (
              <span style={{ float: 'right', fontSize: '0.7rem', color: '#8a97b8' }}>
                limit {AGING_DAYS[stage]} days
              </span>
            )}
          </div>
          <div className="table-scroll-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>MACHINE</th><th>SOURCE</th><th>COST SO FAR</th>
                  <th>DAYS IN STAGE</th><th>BUYER LINED UP</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(d => (
                  <tr key={d.id} className={d.aging ? 'stock-aging' : ''}>
                    <td><strong>{d.make} {d.model}</strong>{d.year ? ` · ${d.year}` : ''}</td>
                    <td>{d.source}{d.country ? ` (${d.country})` : ''}</td>
                    <td>{d.finance && d.finance.needs_fx
                      ? <span className="fx-warn-text">⚠ FX missing</span>
                      : fmtEgp(d.cost)}</td>
                    <td>
                      {d.days === null ? '—' : `${d.days}d`}
                      {d.aging && <span className="aging-badge">⚠ {d.days - AGING_DAYS[d.status]}d over</span>}
                    </td>
                    <td>{d.buyer_name || '—'}</td>
                    <td>{d.aging && <span className="fx-warn-text">consider price drop / push</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StockView;
