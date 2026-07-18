// Designed empty state — an outlined icon in a soft halo + a message, replacing
// bare text like "No assigned machinery." Optional hint line and action button.
import React from 'react';
import Icon from './icons';

export default function EmptyState({ icon = 'sourcing', title, hint, action, compact = false }) {
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}>
      <div className="empty-state-icon"><Icon name={icon} size={compact ? 22 : 30} strokeWidth={1.6} /></div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {action}
    </div>
  );
}
