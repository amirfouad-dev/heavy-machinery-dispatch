import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from 'recharts';
import { parsePrice, currencyOf, computeModelStats, countBy, countByDay, computeFunnel, CLOSED_STATUSES } from '../analytics';
import EmptyState from '../ui/EmptyState';
import { CHART_AXIS, CHART_TOOLTIP, CHART_COLORS } from '../ui/chart';

const COLORS = CHART_COLORS;
const CATEGORY_LABELS = { wheel_loader: 'Wheel Loaders', excavator: 'Excavators', dump_truck: 'Dump Trucks' };

const ReportsView = ({ listings }) => {
  const data = useMemo(() => {
    // Deal funnel + close rate over everything (incl. Sold/Lost history).
    const funnel = computeFunnel(listings);
    const lostRows = Object.entries(funnel.lostReasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // Value only where currency is USD — never sum mixed currencies into one
    // number. Open deals only: sold/lost machines aren't pipeline value.
    let usdValue = 0;
    const byCurrency = {};
    listings.forEach((item) => {
      if (CLOSED_STATUSES.has(item.status)) return;
      const p = parsePrice(item.price);
      if (p === null) return;
      const cur = currencyOf(item);
      byCurrency[cur] = (byCurrency[cur] || 0) + p;
      if (cur === 'USD') usdValue += p;
    });

    const categoryCounts = countBy(listings, 'category', 'Uncategorized');
    const categoryData = Object.keys(categoryCounts).map((k) => ({
      name: CATEGORY_LABELS[k] || k, count: categoryCounts[k],
    }));

    const regionCounts = countBy(listings, 'country', 'Unknown');
    const regionData = Object.keys(regionCounts).map((k) => ({ name: k, value: regionCounts[k] }));

    const sourceCounts = countBy(listings, 'source');
    const sourceData = Object.keys(sourceCounts).map((k) => ({ name: k, value: sourceCounts[k] }));

    const timeData = countByDay(listings);

    // Per-model price table (USD only, models with at least one priced listing).
    const stats = computeModelStats(listings);
    const priceRows = Object.entries(stats)
      .filter(([key]) => key.endsWith('||USD'))
      .map(([key, s]) => ({ model: key.split('||')[0], ...s }))
      .sort((a, b) => b.count - a.count);

    return { funnel, lostRows, usdValue, byCurrency, categoryData, regionData, sourceData, timeData, priceRows };
  }, [listings]);

  const fmt = (n) => '$' + Math.round(n).toLocaleString();
  const otherCurrencies = Object.keys(data.byCurrency).filter((c) => c !== 'USD');

  return (
    <div className="view-container reports-view">
      <div className="view-header">
        <h2>INTELLIGENCE REPORTS</h2>
        <p>Statistical breakdown of the machinery pipeline.</p>
      </div>

      {/* ---- Deal pipeline & close rate (Phase 1) ---- */}
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-title">OPEN DEALS</div>
          <div className="kpi-value">{data.funnel.open}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">WON (PURCHASED+)</div>
          <div className="kpi-value" style={{ color: '#39ff14' }}>{data.funnel.won}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">LOST</div>
          <div className="kpi-value" style={{ color: '#ff5c7a' }}>{data.funnel.lost}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">CLOSE RATE</div>
          <div className="kpi-value">{data.funnel.closeRate === null ? '—' : `${data.funnel.closeRate}%`}</div>
          <div className="kpi-note">won vs lost (decided deals)</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-container">
          <h3>DEAL FUNNEL — COUNT PER STAGE</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.funnel.stageCounts} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
              <XAxis dataKey="stage" {...CHART_AXIS} interval={0} angle={-25} textAnchor="end" height={55} />
              <YAxis {...CHART_AXIS} allowDecimals={false} />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar dataKey="count" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} maxBarSize={46} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>OPERATOR PERFORMANCE</h3>
          <div className="table-container">
            <table className="fleet-table">
              <thead>
                <tr><th>Operator</th><th>Open</th><th>Won</th><th>Lost</th><th>Close rate</th></tr>
              </thead>
              <tbody>
                {data.funnel.operatorRows.map((op) => (
                  <tr key={op.name}>
                    <td><strong>{op.name}</strong></td>
                    <td>{op.open}</td>
                    <td style={{ color: '#39ff14' }}>{op.won}</td>
                    <td style={{ color: '#ff5c7a' }}>{op.lost}</td>
                    <td>{op.rate === null ? '—' : `${op.rate}%`}</td>
                  </tr>
                ))}
                {data.funnel.operatorRows.length === 0 && (
                  <tr><td colSpan="5" style={{ textAlign: 'center', padding: '16px' }}>No claimed deals yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {data.lostRows.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>WHY DEALS ARE LOST</h3>
              <div className="table-container">
                <table className="fleet-table">
                  <tbody>
                    {data.lostRows.map((r) => (
                      <tr key={r.reason}><td>{r.reason}</td><td style={{ textAlign: 'right' }}>{r.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="kpi-row" style={{ marginTop: 20 }}>
        <div className="kpi-card">
          <div className="kpi-title">DEALS (ALL STAGES)</div>
          <div className="kpi-value">{listings.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">EST. VALUE (OPEN, USD)</div>
          <div className="kpi-value">{fmt(data.usdValue)}</div>
          {otherCurrencies.length > 0 && (
            <div className="kpi-note">+ {otherCurrencies.join(', ')} not included</div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-title">CATEGORIES</div>
          <div className="kpi-value">{data.categoryData.length}</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-container">
          <h3>BY CATEGORY</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.categoryData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
              <XAxis dataKey="name" {...CHART_AXIS} />
              <YAxis {...CHART_AXIS} allowDecimals={false} />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar dataKey="count" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={46} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>BY REGION</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.regionData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={4} dataKey="value" stroke="none">
                {data.regionData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...CHART_TOOLTIP} />
              <Legend verticalAlign="bottom" height={30} wrapperStyle={{ fontSize: 12, color: '#8a97b8' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>ACTIVE LISTINGS BY DISCOVERY DATE</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.timeData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#39ff14" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#39ff14" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" {...CHART_AXIS} />
              <YAxis {...CHART_AXIS} allowDecimals={false} />
              <Tooltip {...CHART_TOOLTIP} />
              <Area type="monotone" dataKey="count" stroke="#39ff14" strokeWidth={2} fill="url(#areaFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>BY SOURCE</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.sourceData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={4} dataKey="value" stroke="none">
                {data.sourceData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...CHART_TOOLTIP} />
              <Legend verticalAlign="bottom" height={30} wrapperStyle={{ fontSize: 12, color: '#8a97b8' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-container" style={{ marginTop: 20 }}>
        <h3>PRICE BENCHMARK BY MODEL (USD)</h3>
        <div className="table-container">
          <table className="fleet-table">
            <thead>
              <tr><th>Model</th><th>Listings</th><th>Avg</th><th>Min</th><th>Max</th></tr>
            </thead>
            <tbody>
              {data.priceRows.map((r) => (
                <tr key={r.model}>
                  <td><strong>{r.model}</strong></td>
                  <td>{r.count}</td>
                  <td className="price-tag">{fmt(r.avg)}</td>
                  <td>{fmt(r.min)}</td>
                  <td>{fmt(r.max)}</td>
                </tr>
              ))}
              {data.priceRows.length === 0 && (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '16px' }}>No priced USD listings yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ReportsView;
