// Shared analytics helpers so the dashboard and reports use identical math.

// discovered_at comes from the API as a naive UTC string ("2026-07-08 11:45:30").
// new Date() parses that inconsistently across browsers, so normalize to UTC.
export const parseUTC = (ts) => {
  if (!ts) return null;
  const d = new Date(String(ts).replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
};

// "$70,000" -> 70000 ; "Call for Price"/"" -> null. Only positive numbers count.
export const parsePrice = (price) => {
  if (!price) return null;
  const n = parseFloat(String(price).replace(/[^0-9.]/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
};

export const currencyOf = (item) => item.currency || 'USD';

// Per (model + currency) price stats. Never mix currencies in one average.
export const computeModelStats = (listings) => {
  const groups = {};
  for (const it of listings) {
    const price = parsePrice(it.price);
    if (price === null) continue;
    const key = `${it.make} ${it.model}||${currencyOf(it)}`;
    (groups[key] ||= []).push(price);
  }
  const stats = {};
  for (const [key, prices] of Object.entries(groups)) {
    const sum = prices.reduce((a, b) => a + b, 0);
    stats[key] = {
      count: prices.length,
      avg: sum / prices.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
    };
  }
  return stats;
};

// Flag a listing as a DEAL only when there are enough same-model, same-currency
// comps (minSample) and its price is meaningfully below the average.
export const annotateDeals = (listings, { minSample = 3, threshold = 0.8 } = {}) => {
  const stats = computeModelStats(listings);
  return listings.map((it) => {
    const price = parsePrice(it.price);
    const s = stats[`${it.make} ${it.model}||${currencyOf(it)}`];
    let isDeal = false;
    let dealPct = 0;
    if (price !== null && s && s.count >= minSample && price < s.avg * threshold) {
      isDeal = true;
      dealPct = Math.round((1 - price / s.avg) * 100);
    }
    return { ...it, isDeal, dealPct };
  });
};

// Client mirror of the server's compute_finance (db/database.py) — used ONLY for
// the live "what-if" preview while typing in the finance form. The authoritative
// numbers always come from the server (/finance). Keep the two in sync.
export const computeFinanceEgp = (fin) => {
  const num = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };
  const currency = (fin.purchase_currency || 'USD').toUpperCase();
  const fxRaw = num(fin.fx_to_egp);
  const foreign = num(fin.purchase_price) + num(fin.shipping_cost);
  const localEgp = num(fin.customs_cost) + num(fin.clearance_cost) + num(fin.repair_cost);
  const sale = num(fin.sale_price_egp);
  const needsFx = currency !== 'EGP' && foreign > 0 && fxRaw <= 0;
  if (needsFx) {
    return { needsFx: true, totalCostEgp: null, profitEgp: null, marginPct: null };
  }
  const fx = currency === 'EGP' ? 1 : (fxRaw > 0 ? fxRaw : 1);
  const totalCostEgp = foreign * fx + localEgp;
  const profitEgp = sale > 0 ? sale - totalCostEgp : null;
  const marginPct = (sale > 0 && profitEgp !== null) ? Math.round((profitEgp / sale) * 1000) / 10 : null;
  return { needsFx: false, totalCostEgp, profitEgp, marginPct };
};

export const fmtEgp = (n) =>
  n === null || n === undefined ? '—' : 'E£' + Math.round(n).toLocaleString();

// ---- Profit board aggregation (Phase 3 + company P&L) ----
// deals = /finance array (each with .finance + total_paid/balance/payment_status
// from the server). expenses = /expenses array. Cash view uses real payments;
// company net subtracts company expenses from realized (fully-collected) profit.
// `commissions` = { operatorName: pct } — an operator earns pct% of the profit
// on deals they closed (claimed_by). Commission is a real cost, so it comes out
// of company net alongside expenses.
export const computeProfitBoard = (deals, expenses = [], commissions = {}) => {
  const sold = deals.filter((d) => d.status === 'Sold' && d.finance && d.finance.profit_egp !== null);
  const inProgress = deals.filter((d) => d.status !== 'Sold');

  let totalCommission = 0;
  const commissionRows = {};

  let realizedProfit = 0;   // profit on FULLY-PAID sales (cash truly earned)
  let expectedProfit = 0;   // profit on sold deals still owed money
  let collected = 0;        // total cash received across all owned deals
  let outstanding = 0;      // money customers still owe (receivables)
  let totalRevenue = 0;
  let capitalTiedUp = 0;    // cost sunk into machines not yet sold

  const byModel = {};
  const byCountry = {};
  const monthly = {};
  const daysList = [];

  for (const d of deals) collected += (d.total_paid || 0);

  for (const d of sold) {
    const p = d.finance.profit_egp;
    const rev = d.finance.sale_price_egp || 0;
    totalRevenue += rev;
    if ((d.payment_status || '') === 'Paid') realizedProfit += p;
    else { expectedProfit += p; outstanding += (d.balance || 0); }

    const mk = `${d.make} ${d.model}`;
    (byModel[mk] ||= { name: mk, count: 0, profit: 0 });
    byModel[mk].count += 1; byModel[mk].profit += p;

    const c = d.country || 'Unknown';
    (byCountry[c] ||= { name: c, count: 0, profit: 0 });
    byCountry[c].count += 1; byCountry[c].profit += p;

    if (d.sale_date) {
      const m = String(d.sale_date).slice(0, 7);
      (monthly[m] ||= { month: m, revenue: 0, profit: 0 });
      monthly[m].revenue += rev; monthly[m].profit += p;
    }
    if (d.days_to_sell !== null && d.days_to_sell !== undefined) daysList.push(d.days_to_sell);

    // Commission on realized (paid) deals the operator closed.
    const op = d.claimed_by;
    const pct = op ? Number(commissions[op] || 0) : 0;
    if (pct > 0 && (d.payment_status || '') === 'Paid') {
      const comm = p * pct / 100;
      totalCommission += comm;
      (commissionRows[op] ||= { name: op, pct, commission: 0, deals: 0 });
      commissionRows[op].commission += comm; commissionRows[op].deals += 1;
    }
  }

  for (const d of inProgress) {
    const t = d.finance && d.finance.total_cost_egp;
    if (t) capitalTiedUp += t;
  }

  const totalExpenses = expenses.reduce((a, e) => a + (Number(e.amount_egp) || 0), 0);
  const companyNet = realizedProfit - totalExpenses - totalCommission;

  const avgDaysToSell = daysList.length
    ? Math.round(daysList.reduce((a, b) => a + b, 0) / daysList.length) : null;
  const avgMargin = sold.length
    ? Math.round(sold.reduce((a, d) => a + (d.finance.margin_pct || 0), 0) / sold.length * 10) / 10 : null;

  return {
    soldCount: sold.length,
    inProgressCount: inProgress.length,
    realizedProfit, expectedProfit, collected, outstanding, totalRevenue,
    capitalTiedUp, totalExpenses, totalCommission, companyNet, avgDaysToSell, avgMargin,
    commissionRows: Object.values(commissionRows).sort((a, b) => b.commission - a.commission),
    modelRows: Object.values(byModel).sort((a, b) => b.profit - a.profit),
    countryRows: Object.values(byCountry).sort((a, b) => b.profit - a.profit),
    monthlyRows: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
  };
};

// Build a CSV string from the /finance deals for Excel export.
export const financeToCsv = (deals) => {
  const cols = [
    'Machine', 'Status', 'Country', 'Purchase price', 'Currency', 'FX to EGP',
    'Shipping', 'Customs (EGP)', 'Clearance (EGP)', 'Repairs (EGP)',
    'Total cost (EGP)', 'Sale (EGP)', 'Profit (EGP)', 'Margin %',
    'Buyer', 'Sale date', 'Payment', 'Days to sell',
  ];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = deals.map((d) => {
    const f = d.finance || {};
    return [
      `${d.make} ${d.model}`, d.status, d.country, d.purchase_price, d.purchase_currency,
      d.fx_to_egp, d.shipping_cost, d.customs_cost, d.clearance_cost, d.repair_cost,
      f.total_cost_egp, f.sale_price_egp, f.profit_egp, f.margin_pct,
      d.buyer, d.sale_date, d.payment_status, d.days_to_sell,
    ].map(esc).join(',');
  });
  return [cols.join(','), ...rows].join('\n');
};

export const relativeTime = (date) => {
  if (!date) return '—';
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

// ---- Deal pipeline (Phase 1) ----
// Order matters: it defines the funnel. 'Removed' (junk listing) never reaches
// the dashboard, so it plays no part in close-rate math.
export const PIPELINE_STAGES = [
  'Active', 'Claimed', 'Contacted', 'Negotiating',
  'Purchased', 'Shipping', 'Customs', 'In Stock', 'Sold',
];
// A deal is WON the moment money is committed (Purchased) or any stage after.
export const WON_STATUSES = new Set(['Purchased', 'Shipping', 'Customs', 'In Stock', 'Sold']);
// Terminal states that should not clutter the working (front) views.
export const CLOSED_STATUSES = new Set(['Sold', 'Lost']);

export const LOST_REASONS = [
  'Price too high', 'Already sold', 'Bad condition', 'Seller no response', 'Other',
];

// Funnel + close-rate + per-operator stats, computed from current statuses.
export const computeFunnel = (listings) => {
  const stageCounts = PIPELINE_STAGES.map((s) => ({ stage: s, count: 0 }));
  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s, i) => [s, i]));
  let won = 0, lost = 0, open = 0;
  const lostReasons = {};
  const operators = {};

  for (const it of listings) {
    const st = it.status || 'Active';
    if (st === 'Lost') {
      lost += 1;
      const r = it.lost_reason || 'Unspecified';
      lostReasons[r] = (lostReasons[r] || 0) + 1;
    } else if (byStage[st] !== undefined) {
      stageCounts[byStage[st]].count += 1;
      if (WON_STATUSES.has(st)) won += 1;
      else open += 1;
    }
    // Per-operator: only deals someone actually worked (claimed).
    if (it.claimed_by) {
      const op = (operators[it.claimed_by] ||= { name: it.claimed_by, open: 0, won: 0, lost: 0 });
      if (st === 'Lost') op.lost += 1;
      else if (WON_STATUSES.has(st)) op.won += 1;
      else op.open += 1;
    }
  }

  // Close rate over DECIDED deals (won vs lost); open deals shown separately.
  const decided = won + lost;
  const closeRate = decided > 0 ? Math.round((won / decided) * 100) : null;
  const operatorRows = Object.values(operators).map((op) => {
    const d = op.won + op.lost;
    return { ...op, rate: d > 0 ? Math.round((op.won / d) * 100) : null };
  }).sort((a, b) => (b.won - a.won));

  return { stageCounts, won, lost, open, closeRate, lostReasons, operatorRows };
};

// Count listings grouped by a field (e.g. 'category', 'country').
export const countBy = (listings, field, fallback = 'Unknown') => {
  const out = {};
  for (const it of listings) {
    const k = it[field] || fallback;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
};

// Active listings grouped by discovery day (YYYY-MM-DD, UTC). NOTE: the API only
// returns Active listings, so this is "active by discovery date", not total found.
export const countByDay = (listings) => {
  const out = {};
  for (const it of listings) {
    const d = parseUTC(it.timestamp);
    if (!d) continue;
    const day = d.toISOString().slice(0, 10);
    out[day] = (out[day] || 0) + 1;
  }
  return Object.keys(out).sort().map((day) => ({ day, count: out[day] }));
};
