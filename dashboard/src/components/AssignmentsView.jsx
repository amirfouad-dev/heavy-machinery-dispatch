import React, { useState, useEffect } from 'react';
import { withAuth } from '../auth';
import { PIPELINE_STAGES, CLOSED_STATUSES, LOST_REASONS } from '../analytics';
import { fmtPrice } from '../format';
import Icon from '../ui/icons';
import EmptyState from '../ui/EmptyState';
import { dialogs, toast } from '../ui/feedback';

// Stages an operator can set on a claimed deal (everything after discovery).
const WORK_STAGES = PIPELINE_STAGES.filter(s => s !== 'Active');

const AssignmentsView = ({ listings, handleClaim, handleStatus }) => {
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState({});
  const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

  useEffect(() => {
    fetch(`${API_BASE}/users`, { headers: withAuth() })
      .then(res => res.json())
      .then(data => setUsers(data.users || []))
      .catch(err => console.error(err));
  }, [API_BASE]);

  const unassigned = listings.filter(item => !item.claimed_by && !CLOSED_STATUSES.has(item.status));
  const assigned = listings.filter(item => item.claimed_by && !CLOSED_STATUSES.has(item.status));

  // Mascus is geo-blocked for the staff — send them to our mirrored detail
  // (the ?listing= deep link) instead of the source site. Other sources link out.
  const sourceUrl = (item) =>
    item.source === 'Mascus' ? `/?listing=${item.listing_id}` : item.url;

  const onUserSelect = (listing_id, userName) => {
    setSelectedUsers(prev => ({ ...prev, [listing_id]: userName }));
  };

  // Mark a deal Lost with a structured reason (numbered prompt keeps the
  // reasons consistent so the Reports breakdown stays meaningful).
  const onLost = async (item) => {
    const reason = await dialogs.prompt({
      title: 'Mark deal as lost',
      message: 'Why was this deal lost?',
      options: LOST_REASONS,
    });
    if (!reason) return;
    handleStatus(item.listing_id, 'Lost', reason, item.claimed_by);
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>DISPATCH ASSIGNMENTS</h2>
        <p>Manage operator assignments and complete purchases.</p>
      </div>

      <div className="kanban-board">
        {/* Unassigned Column */}
        <div className="kanban-column">
          <div className="kanban-header">
            <h3>UNASSIGNED <span>{unassigned.length}</span></h3>
          </div>
          <div className="kanban-cards">
            {unassigned.map(item => (
              <div key={item.listing_id} className={`assignment-card border-${item.colorClass}`}>
                <div className="card-header">
                  <span className="make">{item.make}</span>
                  <span className="price">{fmtPrice(item.price, item.currency)}</span>
                </div>
                <div className="card-model">{item.model}</div>
                <div className="card-location"><Icon name="pin" size={13} /> {item.location}</div>
                {item.url && (
                  <a className="card-source-link" href={sourceUrl(item)} target="_blank" rel="noreferrer">
                    <Icon name="link" size={13} /> View listing
                  </a>
                )}
                <div className="assign-controls">
                  <select
                    className="cyber-select"
                    value={selectedUsers[item.listing_id] || ''}
                    onChange={(e) => onUserSelect(item.listing_id, e.target.value)}
                  >
                    <option value="" disabled>Select Operator...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.name}>{u.name}</option>
                    ))}
                  </select>
                  <button 
                    className="claim-btn active"
                    onClick={() => {
                      if(selectedUsers[item.listing_id]) {
                        handleClaim(item.listing_id, selectedUsers[item.listing_id]);
                      } else {
                        toast.info('Pick an operator from the list first (add one in Admin Portal if empty).');
                      }
                    }}
                  >
                    Assign
                  </button>
                </div>
              </div>
            ))}
            {unassigned.length === 0 && <EmptyState compact icon="check" title="All assigned" hint="No machines waiting for an operator." />}
          </div>
        </div>

        {/* Assigned Column — deals in progress move through the pipeline here */}
        <div className="kanban-column">
          <div className="kanban-header claimed">
            <h3>IN PROGRESS <span>{assigned.length}</span></h3>
          </div>
          <div className="kanban-cards">
            {assigned.map(item => (
              <div key={item.listing_id} className="assignment-card claimed">
                <div className="card-header">
                  <span className="make">{item.make}</span>
                  <span className="price">{fmtPrice(item.price, item.currency)}</span>
                </div>
                <div className="card-model">{item.model}</div>
                <div className="card-location"><Icon name="pin" size={13} /> {item.location}</div>
                {item.url && (
                  <a className="card-source-link" href={sourceUrl(item)} target="_blank" rel="noreferrer">
                    <Icon name="link" size={13} /> View listing
                  </a>
                )}
                <div className="operator-badge">
                  Assigned to: <strong>{item.claimed_by}</strong>
                </div>
                <div className="assign-controls">
                  <select
                    className="cyber-select"
                    value={item.status || 'Claimed'}
                    onChange={(e) => handleStatus(item.listing_id, e.target.value, null, item.claimed_by)}
                  >
                    {WORK_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button className="claim-btn lost" onClick={() => onLost(item)}>
                    Lost
                  </button>
                </div>
              </div>
            ))}
            {assigned.length === 0 && <EmptyState compact icon="clipboard" title="Nothing in progress" hint="Assign a machine to start a deal." />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssignmentsView;
