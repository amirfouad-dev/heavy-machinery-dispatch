// Shared Recharts styling so every chart in the app reads as one system:
// consistent axis/gridline/tooltip look, the brand palette, and compact money
// labels (E£1.2M instead of 1200000). Import and spread onto the components.
import { fmtCompact } from '../format';

// Brand-consistent categorical palette (cyan → green → purple → amber → red).
export const CHART_COLORS = ['#00e5ff', '#39ff14', '#b026ff', '#ffb300', '#ff5c7a', '#4dd0e1'];

// Axis props: muted ticks, thin line, no clutter.
export const CHART_AXIS = {
  stroke: '#5a6a90',
  tick: { fill: '#8a97b8', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'rgba(255,255,255,0.08)' },
};

export const CHART_GRID = {
  stroke: 'rgba(255,255,255,0.06)',
  strokeDasharray: '3 3',
  vertical: false,
};

// Dark tooltip that matches the glass panels.
export const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: 'rgba(10,13,26,0.96)',
    border: '1px solid rgba(0,240,255,0.25)',
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    color: '#e7edf6',
    fontSize: 12,
  },
  labelStyle: { color: '#c7d2e2', marginBottom: 4 },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
};

// Y-axis tick formatter for money charts.
export const moneyTick = (sym = 'E£') => (v) => fmtCompact(v, sym);
