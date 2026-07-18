// Loading placeholders — a shimmering block, plus helpers for table rows and
// KPI cards, so views show structure while data loads instead of blank space.
import React from 'react';

export function Skeleton({ w = '100%', h = 14, r = 6, style }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

// N shimmering table rows matching a column count.
export function SkeletonRows({ rows = 5, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="skeleton-row">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j}><Skeleton w={j === 0 ? '60%' : '80%'} /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

// A row of shimmering KPI cards.
export function SkeletonCards({ count = 4 }) {
  return (
    <div className="kpi-row">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="kpi-card">
          <Skeleton w="50%" h={10} />
          <Skeleton w="70%" h={26} style={{ marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}
