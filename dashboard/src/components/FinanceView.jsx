import React, { useState, useEffect, useCallback, useMemo } from 'react';
// Modals must portal to <body>: the glass panel's backdrop-filter makes it the
// containing block for position:fixed, which strands overlays mid-page on mobile.
import { createPortal } from 'react-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { API_BASE } from '../api';
import { withAuth } from '../auth';
import { computeFinanceEgp, fmtEgp, computeProfitBoard, financeToCsv } from '../analytics';
import { statusTheme } from '../statusColors';
import Icon from '../ui/icons';
import EmptyState from '../ui/EmptyState';
import { SkeletonCards } from '../ui/Skeleton';
import { dialogs, toast } from '../ui/feedback';
import { CHART_AXIS, CHART_TOOLTIP, moneyTick } from '../ui/chart';

// Manager-only money page: per-machine costs, sale, installment payments, buyer,
// company expenses, and the aggregate profit board. All data is manager-gated on
// the server; this page is also hidden from operators in the nav.

const CURRENCIES = ['USD', 'EUR', 'GBP', 'EGP'];
const EMPTY = {
  purchase_price: '', purchase_currency: 'USD', fx_to_egp: '',
  shipping_cost: '', customs_cost: '', clearance_cost: '', repair_cost: '',
  sale_price_egp: '', buyer_id: '', sale_date: '', notes: '',
};
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// ---- Installment payments sub-panel (inside the deal modal) ----
function PaymentsPanel({ listingId, salePrice, onChange }) {
  const [rows, setRows] = useState([]);
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');

  const load = useCallback(() => {
    fetch(`${API_BASE}/listings/${listingId}/payments`, { headers: withAuth() })
      .then(r => r.json()).then(d => { setRows(d.payments || []); }).catch(() => {});
  }, [listingId]);
  useEffect(() => { load(); }, [load]);

  const paid = rows.reduce((a, p) => a + (Number(p.amount_egp) || 0), 0);
  const balance = salePrice > 0 ? salePrice - paid : null;
  useEffect(() => { onChange && onChange(paid); }, [paid, onChange]);

  const add = async () => {
    if (!amt) return;
    await fetch(`${API_BASE}/listings/${listingId}/payments`, {
      method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ amount_egp: Number(amt), paid_date: date, method }),
    });
    setAmt(''); setMethod(''); load();
  };
  const del = async (id) => {
    await fetch(`${API_BASE}/payments/${id}`, { method: 'DELETE', headers: withAuth() });
    load();
  };

  return (
    <div className="pay-panel">
      <h3>PAYMENTS / INSTALLMENTS (EGP)</h3>
      {rows.map(p => (
        <div className="pay-row" key={p.id}>
          <span>{p.paid_date || '—'}</span>
          <span>{fmtEgp(p.amount_egp)}</span>
          <span className="pay-method">{p.method || ''}</span>
          <button className="pay-del" onClick={() => del(p.id)} aria-label="Delete payment"><Icon name="x" size={13} /></button>
        </div>
      ))}
      <div className="pay-add">
        <input type="number" placeholder="Amount EGP" value={amt} onChange={e => setAmt(e.target.value)} />
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <input type="text" placeholder="Method (cash, bank…)" value={method} onChange={e => setMethod(e.target.value)} />
        <button className="btn-action" onClick={add} disabled={!amt}><Icon name="plus" size={13} />Add</button>
      </div>
      <div className="pay-summary">
        Paid <b>{fmtEgp(paid)}</b>
        {balance !== null && <> · Balance <b className={balance <= 0 ? 'pos' : 'neg'}>{fmtEgp(balance)}</b></>}
      </div>
    </div>
  );
}

// ---- Invoice / receipt (Phase: paper trail) --------------------------------
// Opens a printable bilingual (EN/AR) invoice in a new tab; the browser's
// "Print → Save as PDF" produces the file the user sends on WhatsApp. Fully
// client-side: Arabic shaping/RTL is native in the browser, no server fonts.
async function openInvoice(deal, form, buyers) {
  let payments = [];
  try {
    const r = await fetch(`${API_BASE}/listings/${deal.id}/payments`, { headers: withAuth() });
    payments = (await r.json()).payments || [];
  } catch { /* invoice still prints without payment rows */ }

  const buyer = buyers.find(b => String(b.id) === String(form.buyer_id)) || {};
  const sale = Number(form.sale_price_egp) || 0;
  const paid = payments.reduce((a, p) => a + (Number(p.amount_egp) || 0), 0);
  const balance = sale - paid;
  const today = new Date().toISOString().slice(0, 10);
  const invoiceNo = `INV-${deal.id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}-${today.replace(/-/g, '')}`;
  const money = (n) => 'EGP ' + Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const payRows = payments.map(p =>
    `<tr><td>${esc(p.paid_date || '—')}</td><td>${esc(p.method || '—')}</td><td class="num">${money(Number(p.amount_egp) || 0)}</td></tr>`
  ).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${invoiceNo}</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #111; margin: 40px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #b8860b; padding-bottom: 14px; }
  .brand { font-size: 26px; font-weight: 800; letter-spacing: 1px; }
  .brand small { display: block; font-size: 13px; color: #555; font-weight: 400; }
  .ar { direction: rtl; text-align: right; font-size: 15px; }
  .meta { margin: 18px 0; display: flex; justify-content: space-between; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; font-size: 14px; text-align: left; }
  th { background: #f5efe0; }
  td.num, th.num { text-align: right; }
  .totals td { font-weight: 700; }
  .balance { color: ${balance > 0 ? '#b00020' : '#0a7a2f'}; }
  .foot { margin-top: 30px; font-size: 12px; color: #666; display: flex; justify-content: space-between; }
  .sig { margin-top: 50px; display: flex; justify-content: space-between; font-size: 13px; }
  .sig div { border-top: 1px solid #999; padding-top: 6px; width: 220px; text-align: center; }
  @media print { body { margin: 15mm; } }
</style></head><body>
  <div class="head">
    <div class="brand">COMPANY HEAVY MACHINES<small>Heavy Equipment Trading — Import &amp; Sale</small></div>
    <div class="ar"><b>ساري للمعدات الثقيلة</b><br>تجارة واستيراد المعدات الثقيلة</div>
  </div>
  <div class="meta">
    <div><b>Invoice / فاتورة:</b> ${invoiceNo}<br><b>Date / التاريخ:</b> ${today}</div>
    <div class="ar"><b>العميل / Buyer:</b> ${esc(buyer.name || '—')}<br>
      ${buyer.company ? esc(buyer.company) + '<br>' : ''}${buyer.phone ? '☎ ' + esc(buyer.phone) : ''}</div>
  </div>
  <table>
    <tr><th>Machine / المعدة</th><th>Year / السنة</th><th class="num">Price / السعر</th></tr>
    <tr><td>${esc(deal.make)} ${esc(deal.model)}</td><td>${esc(deal.year || '—')}</td><td class="num">${money(sale)}</td></tr>
  </table>
  ${payments.length ? `<b>Payments received / الدفعات المستلمة</b>
  <table><tr><th>Date / التاريخ</th><th>Method / الطريقة</th><th class="num">Amount / المبلغ</th></tr>${payRows}</table>` : ''}
  <table class="totals">
    <tr><td>Total / الإجمالي</td><td class="num">${money(sale)}</td></tr>
    <tr><td>Paid / المدفوع</td><td class="num">${money(paid)}</td></tr>
    <tr><td class="balance">Balance due / المتبقي</td><td class="num balance">${money(balance)}</td></tr>
  </table>
  <div class="sig"><div>Seller signature / توقيع البائع</div><div>Buyer signature / توقيع المشتري</div></div>
  <div class="foot"><span>Generated by Heavy Machinery Dispatch — ${today}</span><span>${esc(deal.id)}</span></div>
  <script>window.onload = () => window.print();</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast.error('Popup blocked — allow popups to print the invoice.'); return; }
  w.document.write(html);
  w.document.close();
}

// ---- Documents sub-panel (customs papers, BoL, ID, invoice, photos) ----
function DocumentsPanel({ listingId }) {
  const [docs, setDocs] = useState([]);
  const [type, setType] = useState('Customs');
  const [busy, setBusy] = useState(false);
  const TYPES = ['Customs', 'Bill of Lading', 'Buyer ID', 'Invoice', 'Inspection Photo', 'Other'];

  const load = useCallback(() => {
    fetch(`${API_BASE}/listings/${listingId}/documents`, { headers: withAuth() })
      .then(r => r.json()).then(d => setDocs(d.documents || [])).catch(() => {});
  }, [listingId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('doc_type', type);
      // NOTE: don't set Content-Type — the browser adds the multipart boundary.
      const res = await fetch(`${API_BASE}/listings/${listingId}/documents`, {
        method: 'POST', headers: withAuth(), body: fd,
      });
      if (!res.ok) { const er = await res.json().catch(() => ({})); toast.error(`Upload failed: ${er.detail || res.status}`); }
      else { toast.success('Document uploaded.'); load(); }
    } finally { setBusy(false); e.target.value = ''; }
  };

  const download = async (doc) => {
    const res = await fetch(`${API_BASE}/documents/${doc.id}/download`, { headers: withAuth() });
    if (!res.ok) { toast.error('Download failed.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = doc.original_name; a.click();
    URL.revokeObjectURL(url);
  };

  const del = async (id) => {
    if (!(await dialogs.confirm({ title: 'Delete document', message: 'Delete this document? This cannot be undone.', danger: true, confirmText: 'Delete' }))) return;
    await fetch(`${API_BASE}/documents/${id}`, { method: 'DELETE', headers: withAuth() });
    toast.success('Document deleted.');
    load();
  };

  return (
    <div className="pay-panel">
      <h3>DOCUMENTS</h3>
      {docs.map(d => (
        <div className="pay-row" key={d.id}>
          <span>{d.doc_type}</span>
          <a href="#" onClick={(e) => { e.preventDefault(); download(d); }}>{d.original_name}</a>
          <span className="pay-method">{Math.round((d.size_bytes || 0) / 1024)} KB</span>
          <button className="pay-del" onClick={() => del(d.id)} aria-label="Delete document"><Icon name="x" size={13} /></button>
        </div>
      ))}
      {docs.length === 0 && <div className="pay-method" style={{ padding: '4px 0' }}>No documents attached.</div>}
      <div className="pay-add" style={{ gridTemplateColumns: '1fr auto' }}>
        <select value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="btn-action" style={{ cursor: 'pointer' }}>
          <Icon name="download" size={14} style={{ transform: 'rotate(180deg)' }} />{busy ? 'Uploading…' : 'Upload'}
          <input type="file" style={{ display: 'none' }} onChange={upload} disabled={busy} />
        </label>
      </div>
    </div>
  );
}

function FinanceModal({ deal, buyers, onClose, onSaved, onBuyerAdded }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/listings/${deal.id}/finance`, { headers: withAuth() })
      .then(r => r.json()).then(d => {
        if (!alive) return;
        const f = d.finance || {};
        setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, f[k] ?? EMPTY[k]])) });
      }).catch(() => {});
    return () => { alive = false; };
  }, [deal.id]);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const isEgp = (form.purchase_currency || 'USD').toUpperCase() === 'EGP';
  const preview = computeFinanceEgp(form);
  const cur = form.purchase_currency || 'USD';

  const addBuyer = async () => {
    const name = await dialogs.prompt({ title: 'New buyer', message: "Buyer's name", placeholder: 'Full name' });
    if (!name) return;
    const phone = (await dialogs.prompt({ title: 'New buyer', message: 'Phone (optional)', placeholder: 'Phone number' })) || null;
    const res = await fetch(`${API_BASE}/buyers`, {
      method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, phone }),
    });
    const d = await res.json();
    await onBuyerAdded();
    set('buyer_id', d.id);
    toast.success(`Buyer “${name}” added.`);
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/listings/${deal.id}/finance`, {
        method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          purchase_price: numOrNull(form.purchase_price), purchase_currency: form.purchase_currency,
          fx_to_egp: numOrNull(form.fx_to_egp), shipping_cost: numOrNull(form.shipping_cost),
          customs_cost: numOrNull(form.customs_cost), clearance_cost: numOrNull(form.clearance_cost),
          repair_cost: numOrNull(form.repair_cost), sale_price_egp: numOrNull(form.sale_price_egp),
          buyer_id: numOrNull(form.buyer_id), sale_date: form.sale_date || null, notes: form.notes || null,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast.error(`Save failed: ${e.detail || res.status}`); return; }
      toast.success('Finance saved.');
      onSaved();
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="sourcing-modal-overlay" onClick={onClose}>
      <div className="sourcing-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">
          <h2>{deal.make} {deal.model} <span style={{ fontSize: '0.7em', color: '#8a97b8' }}>· {deal.status}</span></h2>
        </div>

        <div className="fin-form">
          <h3>PURCHASE &amp; OVERSEAS (in {cur})</h3>
          <div className="fin-grid">
            <label>Purchase price ({cur})<input type="number" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} /></label>
            <label>Currency<select value={form.purchase_currency} onChange={e => set('purchase_currency', e.target.value)}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
            <label>Overseas freight ({cur})<input type="number" value={form.shipping_cost} onChange={e => set('shipping_cost', e.target.value)} /></label>
            {!isEgp && <label className={preview.needsFx ? 'fx-warn' : ''}>FX rate (1 {cur} = ? EGP)<input type="number" value={form.fx_to_egp} onChange={e => set('fx_to_egp', e.target.value)} placeholder="e.g. 50" /></label>}
          </div>

          <h3>LOCAL COSTS (EGP)</h3>
          <div className="fin-grid">
            <label>Customs &amp; taxes<input type="number" value={form.customs_cost} onChange={e => set('customs_cost', e.target.value)} /></label>
            <label>Clearance / port<input type="number" value={form.clearance_cost} onChange={e => set('clearance_cost', e.target.value)} /></label>
            <label>Repairs / refurb<input type="number" value={form.repair_cost} onChange={e => set('repair_cost', e.target.value)} /></label>
          </div>

          <h3>SALE (EGP)</h3>
          <div className="fin-grid">
            <label>Sale price<input type="number" value={form.sale_price_egp} onChange={e => set('sale_price_egp', e.target.value)} /></label>
            <label>Buyer
              <select value={form.buyer_id || ''} onChange={e => e.target.value === '__new' ? addBuyer() : set('buyer_id', e.target.value)}>
                <option value="">— none —</option>
                {buyers.map(b => <option key={b.id} value={b.id}>{b.name}{b.company ? ` (${b.company})` : ''}</option>)}
                <option value="__new">＋ Add new buyer…</option>
              </select></label>
            <label>Sale date<input type="date" value={form.sale_date || ''} onChange={e => set('sale_date', e.target.value)} /></label>
          </div>

          <div className="fin-preview">
            {preview.needsFx ? <span className="fx-warn-text">⚠ Enter the FX rate to compute cost &amp; profit in EGP.</span> : (
              <>
                <span>Total cost: <b>{fmtEgp(preview.totalCostEgp)}</b></span>
                <span>Profit: <b className={preview.profitEgp >= 0 ? 'pos' : 'neg'}>{fmtEgp(preview.profitEgp)}</b></span>
                <span>Margin: <b>{preview.marginPct === null ? '—' : preview.marginPct + '%'}</b></span>
              </>
            )}
          </div>

          <PaymentsPanel listingId={deal.id} salePrice={numOrNull(form.sale_price_egp) || 0} />

          <DocumentsPanel listingId={deal.id} />

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="login-btn" style={{ flex: 1 }} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save finance'}</button>
            <button className="btn-action" style={{ padding: '10px 18px' }}
              onClick={() => openInvoice(deal, form, buyers)}
              disabled={!numOrNull(form.sale_price_egp)}
              title={numOrNull(form.sale_price_egp) ? 'Open printable invoice' : 'Enter a sale price first'}>
              <Icon name="invoice" size={14} />Invoice
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---- Company expenses panel ----
function ExpensesPanel({ expenses, reload }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cat, setCat] = useState('');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');

  const add = async () => {
    if (!cat || !amt) return;
    await fetch(`${API_BASE}/expenses`, {
      method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expense_date: date, category: cat, amount_egp: Number(amt), note }),
    });
    setCat(''); setAmt(''); setNote(''); reload();
  };
  const del = async (id) => {
    await fetch(`${API_BASE}/expenses/${id}`, { method: 'DELETE', headers: withAuth() });
    reload();
  };

  return (
    <div className="widget table-widget" style={{ marginTop: 20 }}>
      <div className="widget-header">COMPANY EXPENSES <span className="dots">•••</span></div>
      <div className="table-scroll-container">
        <table className="data-table">
          <thead><tr><th>DATE</th><th>CATEGORY</th><th>AMOUNT</th><th>NOTE</th><th></th></tr></thead>
          <tbody>
            <tr className="expense-add-row">
              <td><input type="date" value={date} onChange={e => setDate(e.target.value)} /></td>
              <td><input type="text" placeholder="Rent, Salary, Commission…" value={cat} onChange={e => setCat(e.target.value)} /></td>
              <td><input type="number" placeholder="EGP" value={amt} onChange={e => setAmt(e.target.value)} /></td>
              <td><input type="text" placeholder="note" value={note} onChange={e => setNote(e.target.value)} /></td>
              <td><button className="btn-action" onClick={add} disabled={!cat || !amt}><Icon name="plus" size={13} />Add</button></td>
            </tr>
            {expenses.map(e => (
              <tr key={e.id}>
                <td>{e.expense_date}</td><td>{e.category}</td>
                <td>{fmtEgp(e.amount_egp)}</td><td>{e.note || '—'}</td>
                <td><button className="btn-action remove-btn" onClick={() => del(e.id)}><Icon name="trash" size={13} />Delete</button></td>
              </tr>
            ))}
            {expenses.length === 0 && <tr><td colSpan="5"><EmptyState compact icon="money" title="No expenses yet" hint="Record rent, salaries, and other costs here." /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FinanceView = () => {
  const [deals, setDeals] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [commissions, setCommissions] = useState({});
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const loadDeals = useCallback(() => {
    fetch(`${API_BASE}/finance`, { headers: withAuth() })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => setDeals(d.deals || [])).catch(e => setError(e.message));
  }, []);
  const loadExpenses = useCallback(() => {
    fetch(`${API_BASE}/expenses`, { headers: withAuth() }).then(r => r.json()).then(d => setExpenses(d.expenses || [])).catch(() => {});
  }, []);
  const loadBuyers = useCallback(() => {
    return fetch(`${API_BASE}/buyers`, { headers: withAuth() }).then(r => r.json()).then(d => setBuyers(d.buyers || [])).catch(() => {});
  }, []);
  const loadCommissions = useCallback(() => {
    fetch(`${API_BASE}/users`, { headers: withAuth() }).then(r => r.json())
      .then(d => setCommissions(Object.fromEntries((d.users || [])
        .filter(u => u.commission_pct).map(u => [u.name, u.commission_pct])))).catch(() => {});
  }, []);
  useEffect(() => { loadDeals(); loadExpenses(); loadBuyers(); loadCommissions(); },
    [loadDeals, loadExpenses, loadBuyers, loadCommissions]);

  const board = useMemo(() => computeProfitBoard(deals || [], expenses, commissions), [deals, expenses, commissions]);

  const exportCsv = () => {
    const csv = financeToCsv(deals || []);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `finance_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const badge = (s) => s === 'Paid' ? 'pos' : (s === 'Partial' ? 'warn' : '');

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>FINANCE · PROFIT BOARD</h2>
        <p>Costs, sales, payments &amp; company profit (EGP). Manager only.</p>
      </div>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-title">COMPANY NET (AFTER EXPENSES)</div>
          <div className="kpi-value" style={{ color: board.companyNet >= 0 ? '#39ff14' : '#ff5c7a' }}>{fmtEgp(board.companyNet)}</div>
          <div className="kpi-note">realized {fmtEgp(board.realizedProfit)} − exp {fmtEgp(board.totalExpenses)}
            {board.totalCommission > 0 ? ` − comm ${fmtEgp(board.totalCommission)}` : ''}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">CASH COLLECTED</div>
          <div className="kpi-value">{fmtEgp(board.collected)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">OUTSTANDING (OWED)</div>
          <div className="kpi-value" style={{ color: '#ffb300' }}>{fmtEgp(board.outstanding)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">CAPITAL TIED UP</div>
          <div className="kpi-value">{fmtEgp(board.capitalTiedUp)}</div>
          <div className="kpi-note">{board.inProgressCount} in progress</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-container">
          <h3>MONTHLY PROFIT (EGP)</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={board.monthlyRows} margin={{ top: 16, right: 16, left: 0, bottom: 5 }}>
              <XAxis dataKey="month" {...CHART_AXIS} />
              <YAxis {...CHART_AXIS} tickFormatter={moneyTick('E£')} width={52} />
              <Tooltip {...CHART_TOOLTIP} formatter={(v) => [fmtEgp(v), 'Profit']} />
              <Bar dataKey="profit" fill="#39ff14" radius={[4, 4, 0, 0]} maxBarSize={54} />
            </BarChart>
          </ResponsiveContainer>
          {board.monthlyRows.length === 0 && <EmptyState compact icon="reports" title="No sales recorded yet" hint="Monthly profit appears once you sell a machine." />}
        </div>
        <div className="chart-container">
          <h3>PROFIT BY MODEL (EGP)</h3>
          <div className="table-container">
            <table className="fleet-table">
              <thead><tr><th>Model</th><th>Sold</th><th>Profit</th></tr></thead>
              <tbody>
                {board.modelRows.map(m => (<tr key={m.name}><td><strong>{m.name}</strong></td><td>{m.count}</td><td className={m.profit >= 0 ? 'pos' : 'neg'}>{fmtEgp(m.profit)}</td></tr>))}
                {board.modelRows.length === 0 && <tr><td colSpan="3" style={{ textAlign: 'center', padding: 14 }}>No sales yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="widget table-widget" style={{ marginTop: 20 }}>
        <div className="widget-header">
          DEAL FINANCE
          <button className="btn-action" style={{ float: 'right' }} onClick={exportCsv} disabled={!deals || deals.length === 0}><Icon name="download" size={14} />Export CSV</button>
        </div>
        <div className="table-scroll-container">
          <table className="data-table">
            <thead><tr><th>MACHINE</th><th>STATUS</th><th>BUYER</th><th>TOTAL COST</th><th>SALE</th><th>PROFIT</th><th>PAID</th><th>BALANCE</th><th></th></tr></thead>
            <tbody>
              {deals && deals.map(d => {
                const f = d.finance || {};
                return (
                  <tr key={d.id}>
                    <td><strong>{d.make} {d.model}</strong></td>
                    <td><span className={`status-badge ${statusTheme(d.status)}`}>{d.status}</span></td>
                    <td>{d.buyer_name || '—'}</td>
                    <td>{f.needs_fx ? <span className="fx-warn-text">⚠ FX?</span> : fmtEgp(f.total_cost_egp)}</td>
                    <td>{fmtEgp(f.sale_price_egp)}</td>
                    <td>{f.profit_egp == null ? '—' : <b className={f.profit_egp >= 0 ? 'pos' : 'neg'}>{fmtEgp(f.profit_egp)}</b>}</td>
                    <td>{d.payment_status ? <span className={badge(d.payment_status)}>{fmtEgp(d.total_paid)}</span> : '—'}</td>
                    <td>{d.balance == null ? '—' : <b className={d.balance <= 0 ? 'pos' : 'neg'}>{fmtEgp(d.balance)}</b>}</td>
                    <td><button className="btn-action" onClick={() => setEditing(d)}>Edit</button></td>
                  </tr>
                );
              })}
              {deals && deals.length === 0 && <tr><td colSpan="9"><EmptyState icon="money" title="No owned machines yet" hint='A deal appears here once it reaches "Purchased".' /></td></tr>}
              {!deals && !error && <tr><td colSpan="9" style={{ padding: 10 }}><SkeletonCards count={3} /></td></tr>}
              {error && <tr><td colSpan="9"><EmptyState icon="alert" title="Couldn't load finance" hint={error} /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {board.commissionRows && board.commissionRows.length > 0 && (
        <div className="chart-container" style={{ marginTop: 20 }}>
          <h3>OPERATOR COMMISSIONS (on paid, closed deals)</h3>
          <div className="table-container">
            <table className="fleet-table">
              <thead><tr><th>Operator</th><th>Rate</th><th>Deals</th><th>Commission owed</th></tr></thead>
              <tbody>
                {board.commissionRows.map(c => (
                  <tr key={c.name}><td><strong>{c.name}</strong></td><td>{c.pct}%</td><td>{c.deals}</td>
                    <td className="warn">{fmtEgp(c.commission)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="kpi-note" style={{ marginTop: 8 }}>Set each operator's rate in Admin Portal. Commission is deducted from Company Net.</p>
        </div>
      )}

      <ExpensesPanel expenses={expenses} reload={loadExpenses} />

      {editing && (
        <FinanceModal
          deal={editing} buyers={buyers}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadDeals(); }}
          onBuyerAdded={loadBuyers}
        />
      )}
    </div>
  );
};

export default FinanceView;
