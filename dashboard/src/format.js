// Presentation formatters — one consistent style everywhere. These normalize the
// look of data that arrives in many shapes from different scrapers (e.g. prices
// like "$35,000", "USD 28,800", "DKK 1,485,000", "Call for Price"). We unify the
// STYLE, never the currency: EUR/AUD/DKK/USD stay in their own currency (no FX).
import { parsePrice } from './analytics';

// Map a currency code or symbol found in raw price text to a clean symbol.
const SYMBOL = {
  USD: '$', CAD: 'C$', AUD: 'A$', EUR: '€', GBP: '£',
  DKK: 'kr', NOK: 'kr', SEK: 'kr', PLN: 'zł', EGP: 'E£', CNY: '¥',
};

// Pull a currency token out of a raw price string, if present.
const currencyFromText = (raw) => {
  const s = String(raw).toUpperCase();
  for (const code of Object.keys(SYMBOL)) {
    if (s.includes(code)) return code;
  }
  if (s.includes('$')) return 'USD';
  if (s.includes('€')) return 'EUR';
  if (s.includes('£')) return 'GBP';
  return null;
};

// Format a listing/deal price consistently. `raw` is the price field; `fallbackCur`
// is the item's currency column when the raw text has no currency token.
// Returns a clean "€ 28,800" style string, or "Call for price" when unknown.
export const fmtPrice = (raw, fallbackCur) => {
  const n = parsePrice(raw);
  if (n === null) return 'Call for price';
  const code = currencyFromText(raw) || (fallbackCur || '').toUpperCase() || 'USD';
  const sym = SYMBOL[code] || code + ' ';
  return `${sym} ${Math.round(n).toLocaleString('en-US')}`;
};

// Machine running hours: "4,970 h" or an em dash when unknown.
export const fmtHours = (h) => {
  if (h === null || h === undefined || h === '') return '—';
  const n = typeof h === 'number' ? h : parseFloat(String(h).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? '—' : `${Math.round(n).toLocaleString('en-US')} h`;
};

// Year: keep only a real 4-digit year, else em dash.
export const fmtYear = (y) => {
  if (!y) return '—';
  const n = parseInt(y, 10);
  return n >= 1900 && n <= 2100 ? String(n) : '—';
};

// Abbreviated money for chart axes/labels: 1_200_000 -> "1.2M". Keeps a currency
// symbol prefix (defaults to EGP since the money charts are all in EGP).
export const fmtCompact = (n, sym = 'E£') => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${sym}${Math.round(abs / 1e3)}K`;
  return `${sign}${sym}${Math.round(abs)}`;
};

// Short absolute date: "9 Jul 2026" (stable across locales, no ambiguity).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (input) => {
  if (!input) return '—';
  const d = input instanceof Date ? input : new Date(String(input).replace(' ', 'T') + (String(input).includes('T') ? '' : 'Z'));
  if (isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
