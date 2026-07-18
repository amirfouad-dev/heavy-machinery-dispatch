import React, { useMemo } from 'react';
import { getUser } from '../auth';
import { PIPELINE_STAGES, CLOSED_STATUSES, LOST_REASONS } from '../analytics';
import { fmtPrice } from '../format';
import Icon from '../ui/icons';
import EmptyState from '../ui/EmptyState';
import { dialogs } from '../ui/feedback';

// Operator "My Work" — phone-first. Two jobs: claim new machines, and move my
// own deals along after a call. No money, no tables — just tap-sized cards.
// Operators land here by default.

const WORK_STAGES = PIPELINE_STAGES.filter(s => s !== 'Active');

const MyWorkView = ({ listings, handleClaim, handleStatus }) => {
  const me = getUser()?.name;

  const newListings = useMemo(
    () => (listings || [])
      .filter(l => !l.claimed_by && (l.status === 'Active'))
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))),
    [listings]
  );

  const myDeals = useMemo(
    () => (listings || []).filter(l => l.claimed_by === me && !CLOSED_STATUSES.has(l.status)),
    [listings, me]
  );

  const markLost = async (item) => {
    const reason = await dialogs.prompt({
      title: 'Mark deal as lost',
      message: 'Why was this deal lost?',
      options: LOST_REASONS,
    });
    if (!reason) return;
    handleStatus(item.listing_id, 'Lost', reason, me);
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>MY WORK</h2>
        <p>Hi {me || 'there'} — claim new machines and update your deals.</p>
      </div>

      {/* My active deals first — the thing to act on after a call */}
      <div className="work-section">
        <h3 className="work-heading"><Icon name="clipboard" size={17} /> MY DEALS <span>{myDeals.length}</span></h3>
        {myDeals.length === 0 && (
          <EmptyState compact icon="clipboard" title="No deals assigned to you yet"
            hint="Claim a machine below to start working it." />
        )}
        <div className="work-cards">
          {myDeals.map(item => (
            <div className="work-card mine" key={item.listing_id}>
              <div className="work-card-top">
                <span className="work-machine">{item.make} {item.model}</span>
                <span className="work-price">{fmtPrice(item.price, item.currency)}</span>
              </div>
              <div className="work-meta"><Icon name="pin" size={13} /> {item.location || 'Unknown'} · {item.source}</div>
              <div className="work-actions">
                <select
                  className="cyber-select"
                  value={item.status || 'Claimed'}
                  onChange={(e) => handleStatus(item.listing_id, e.target.value, null, me)}
                >
                  {WORK_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className="claim-btn lost" onClick={() => markLost(item)}>Lost</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* New unclaimed machines to grab */}
      <div className="work-section">
        <h3 className="work-heading"><Icon name="sparkle" size={17} /> NEW MACHINES <span>{newListings.length}</span></h3>
        {newListings.length === 0 && (
          <EmptyState compact icon="excavator" title="Nothing new to claim right now"
            hint="New machines appear here automatically as the harvester finds them." />
        )}
        <div className="work-cards">
          {newListings.map(item => (
            <div className="work-card" key={item.listing_id}>
              <div className="work-card-top">
                <span className="work-machine">{item.make} {item.model}</span>
                <span className="work-price">{fmtPrice(item.price, item.currency)}</span>
              </div>
              <div className="work-meta"><Icon name="pin" size={13} /> {item.location || 'Unknown'} · {item.source}
                {item.isDeal && <span className="deal-badge" title={`${item.dealPct}% below avg`}>DEAL −{item.dealPct}%</span>}
              </div>
              <div className="work-actions">
                <button className="claim-btn active" onClick={() => handleClaim(item.listing_id, me)}>
                  Claim this
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MyWorkView;
