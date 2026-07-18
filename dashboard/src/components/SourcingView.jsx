import React, { useState, useEffect, useMemo, useCallback } from 'react';
// Modals must portal to <body>: the glass panel's backdrop-filter makes it the
// containing block for position:fixed, which strands overlays mid-page on mobile.
import { createPortal } from 'react-dom';
import { API_BASE } from '../api';
import { withAuth, getToken } from '../auth';
import { fmtPrice, fmtHours, fmtYear } from '../format';
import Icon from '../ui/icons';
import EmptyState from '../ui/EmptyState';

// Mascus (and future geo-blocked sources) are MIRRORED onto our own server:
// photos + seller contact are re-hosted here so staff in a region the source
// blocks can view everything without ever reaching the source site. This page
// is the front door to that mirror — same claim/assign/remove actions as the
// main dashboard, plus a detail view served entirely from our VPS.

// Photos are behind login too; <img> can't send headers, so pass the session
// token as a query param the API accepts.
const mediaUrl = (rel) => `${API_BASE}/media/${rel}?t=${encodeURIComponent(getToken() || '')}`;

function DetailModal({ listingId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [activeImg, setActiveImg] = useState(0);

  useEffect(() => {
    let alive = true;
    setDetail(null); setError(null); setActiveImg(0);
    fetch(`${API_BASE}/listings/${listingId}/detail`, { headers: withAuth() })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (alive) setDetail(d); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [listingId]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const images = detail?.images || [];

  return createPortal(
    <div className="sourcing-modal-overlay" onClick={onClose}>
      <div className="sourcing-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        {!detail && !error && <div className="modal-loading">Loading mirrored listing…</div>}
        {error && <div className="modal-loading">Couldn’t load detail: {error}</div>}

        {detail && (
          <div className="modal-body">
            <div className="modal-title">
              <h2>{detail.make} {detail.model}</h2>
              <span className="modal-price">{fmtPrice(detail.price, detail.currency)}</span>
            </div>

            {/* Mirrored photo gallery (served from our VPS) */}
            {images.length > 0 ? (
              <div className="gallery">
                <div className="gallery-main">
                  <img src={mediaUrl(images[activeImg])} alt={`${detail.make} ${detail.model}`} />
                </div>
                {images.length > 1 && (
                  <div className="gallery-thumbs">
                    {images.map((img, i) => (
                      <img
                        key={img}
                        src={mediaUrl(img)}
                        className={i === activeImg ? 'active' : ''}
                        onClick={() => setActiveImg(i)}
                        alt={`view ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="gallery-empty">No mirrored photos for this listing.</div>
            )}

            <div className="modal-grid">
              {/* Specs */}
              <div className="modal-card">
                <h3>SPECIFICATIONS</h3>
                <ul className="spec-list">
                  <li><span>Category</span><b>{(detail.category || '—').replace('_', ' ')}</b></li>
                  <li><span>Year</span><b>{fmtYear(detail.year)}</b></li>
                  <li><span>Hours</span><b>{fmtHours(detail.hours)}</b></li>
                  <li><span>Price</span><b>{fmtPrice(detail.price, detail.currency)}</b></li>
                  <li><span>Location</span><b>{detail.location || '—'}</b></li>
                  <li><span>Source</span><b>{detail.source}</b></li>
                  <li><span>Status</span><b>{detail.status}{detail.claimed_by ? ` · ${detail.claimed_by}` : ''}</b></li>
                </ul>
              </div>

              {/* Seller contact (mirrored) */}
              <div className="modal-card">
                <h3>SELLER CONTACT</h3>
                {(detail.seller_name || detail.seller_phone || detail.seller_email || detail.seller_company) ? (
                  <ul className="spec-list">
                    {detail.seller_name && <li><span>Contact</span><b>{detail.seller_name}</b></li>}
                    {detail.seller_company && <li><span>Company</span><b>{detail.seller_company}</b></li>}
                    {detail.seller_phone && (
                      <li><span>Phone</span><b><a href={`tel:${detail.seller_phone}`}>{detail.seller_phone}</a></b></li>
                    )}
                    {detail.seller_email && (
                      <li><span>Email</span><b><a href={`mailto:${detail.seller_email}`}>{detail.seller_email}</a></b></li>
                    )}
                    {detail.seller_website && (
                      <li><span>Website</span><b>
                        <a href={/^https?:/.test(detail.seller_website) ? detail.seller_website : `https://${detail.seller_website}`}
                           target="_blank" rel="noreferrer">{detail.seller_website}</a>
                      </b></li>
                    )}
                    {detail.seller_address && <li><span>Address</span><b>{detail.seller_address}</b></li>}
                  </ul>
                ) : (
                  <p className="empty-msg">
                    No direct contact captured (likely an auction lot). Dealer:{' '}
                    <strong>{detail.seller_company || 'Unknown'}</strong>.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

const SourcingView = ({ listings, handleClaim, handleRemove, initialListingId }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [openId, setOpenId] = useState(null);

  // Only mirrored (Mascus) listings live on this page.
  const mascus = useMemo(
    () => listings.filter(l => l.source === 'Mascus'),
    [listings]
  );

  // Deep link from the Telegram alert (?listing=<id>): open that detail once the
  // listing is present in the fetched data.
  useEffect(() => {
    if (initialListingId) setOpenId(initialListingId);
  }, [initialListingId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mascus.filter(l => {
      if (statusFilter !== 'All' && l.status !== statusFilter) return false;
      if (q) {
        const hay = `${l.make} ${l.model} ${l.location} ${l.listing_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [mascus, search, statusFilter]);

  const closeModal = useCallback(() => setOpenId(null), []);

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>SOURCING · MASCUS (EU / GLOBAL)</h2>
        <p>Mirrored listings — photos &amp; seller contact re-hosted on our server, viewable anywhere.</p>
      </div>

      <div className="widget table-widget" style={{ flex: 1, minHeight: 0 }}>
        <div className="widget-header">
          MIRRORED INVENTORY <span className="dots">•••</span>
        </div>
        <div className="table-filter-bar">
          <div className="search-field">
            <Icon name="search" size={16} className="search-ic" />
            <input
              className="table-search"
              type="text"
              placeholder="Search make, model, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="table-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {['All', 'Active', 'Claimed'].map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>)}
          </select>
          <span className="table-count">{filtered.length} / {mascus.length}</span>
        </div>
        <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>MACHINERY ID</th>
                <th>MAKE &amp; MODEL</th>
                <th>YEAR</th>
                <th>PRICE</th>
                <th>OPERATOR</th>
                <th>LOCATION</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.listing_id}>
                  <td>
                    <div className="id-cell">
                      <span className={`status-dot ${item.colorClass}`}></span>
                      {item.listing_id}
                    </div>
                  </td>
                  <td>
                    {item.make} {item.model}
                    {item.isDeal && <span className="deal-badge" title={`${item.dealPct}% below average`}>DEAL −{item.dealPct}%</span>}
                  </td>
                  <td>{item.year || '—'}</td>
                  <td className="price-cell">{fmtPrice(item.price, item.currency)}</td>
                  <td>{item.operator}</td>
                  <td>{item.location}</td>
                  <td><span className={`status-badge ${item.colorClass}`}>{item.status}</span></td>
                  <td>
                    <button className="btn-action" onClick={() => setOpenId(item.listing_id)}>
                      <Icon name="search" size={13} />View
                    </button>
                    {item.status === 'Active' && (
                      <button className="btn-action" onClick={() => handleClaim(item.listing_id)}>
                        Claim/Assign
                      </button>
                    )}
                    <button className="btn-action remove-btn" onClick={() => handleRemove(item.listing_id)}>
                      <Icon name="trash" size={13} />Remove
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="8">
                  <EmptyState icon="sourcing"
                    title={mascus.length === 0 ? 'No mirrored listings yet' : 'No matches'}
                    hint={mascus.length === 0
                      ? 'The server harvests Mascus on each run; listings appear here automatically.'
                      : 'Try clearing the search or status filter.'} />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openId && <DetailModal listingId={openId} onClose={closeModal} />}
    </div>
  );
};

export default SourcingView;
