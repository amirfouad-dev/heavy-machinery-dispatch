import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './index.css'
import { API_BASE } from './api'
import { withAuth, getUser, isManager, logout as authLogout, verifySession } from './auth'
import { annotateDeals, parseUTC, relativeTime, CLOSED_STATUSES, PIPELINE_STAGES, LOST_REASONS } from './analytics'
import { fmtPrice } from './format'
import { statusTheme } from './statusColors'
import Icon from './ui/icons'
import { toast, dialogs } from './ui/feedback'
import EmptyState from './ui/EmptyState'
import { SkeletonRows } from './ui/Skeleton'

import FleetStatusView from './components/FleetStatusView'
import AssignmentsView from './components/AssignmentsView'
import LiveTrackingView from './components/LiveTrackingView'
import ReportsView from './components/ReportsView'
import AdminPanelView from './components/AdminPanelView'
import SourcingView from './components/SourcingView'
import FinanceView from './components/FinanceView'
import BuyersView from './components/BuyersView'
import StockView from './components/StockView'
import OverviewView from './components/OverviewView'
import MyWorkView from './components/MyWorkView'
import AddMachineModal from './components/AddMachineModal'
import ChangePasswordModal from './components/ChangePasswordModal'
import LoginView from './components/LoginView'

const createGlowIcon = (colorClass) => {
  return L.divIcon({
    className: `leaflet-glow-container`,
    html: `<div class="custom-glow-icon ${colorClass}"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

function App() {
  const [user, setUser] = useState(() => getUser())
  const [authChecked, setAuthChecked] = useState(false)
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  // Managers land on the Overview home; operators on their My Work screen.
  const [activeTab, setActiveTab] = useState(() => isManager() ? 'Overview' : 'My Work')
  const [syncStatus, setSyncStatus] = useState('connecting') // 'online' | 'offline'
  const [lastSync, setLastSync] = useState(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')

  const [showAdd, setShowAdd] = useState(false)
  const [showChangePw, setShowChangePw] = useState(false)
  const [backingUp, setBackingUp] = useState(false)

  // One-click backup: pull a fresh copy of the whole database to this device.
  const downloadBackup = async () => {
    setBackingUp(true)
    try {
      const res = await fetch(`${API_BASE}/backup/download`, { headers: withAuth() })
      if (!res.ok) { toast.error('Backup failed. Please try again.'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      a.href = url; a.download = `machinery-backup-${stamp}.db`; a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup downloaded.')
    } catch {
      toast.error('Backup failed. Please try again.')
    } finally {
      setBackingUp(false)
    }
  }

  // Deep link from a mirrored-source Telegram alert (?listing=<id>): jump
  // straight to the Sourcing page and open that listing's mirrored detail.
  const [deepListingId] = useState(() => new URLSearchParams(window.location.search).get('listing'))
  useEffect(() => {
    if (deepListingId) {
      setActiveTab('Sourcing')
      // Drop the param from the address bar so a refresh (or a bookmark of this
      // URL) doesn't reopen the same listing forever.
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [deepListingId])

  const fetchListings = async () => {
    try {
      const response = await fetch(`${API_BASE}/listings`, { headers: withAuth() })
      if (response.status === 401) {
        // Session expired or revoked server-side: drop to the login screen
        // instead of showing a misleading "offline" badge.
        await authLogout()
        setUser(null)
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()

      // Process data for UI. colorClass now encodes the pipeline STATUS (semantic),
      // not the row index — it drives the status dot/badge and the map marker glow.
      const processedListings = data.listings.map((item) => {
        const status = item.status || (item.claimed_by ? 'Claimed' : 'Active');
        return {
          ...item,
          status,
          colorClass: statusTheme(status),
          action: item.claimed_by ? 'Assigned' : 'Track',
          operator: item.claimed_by || 'Unassigned',
        }
      })

      // Flag below-average-priced listings (needs enough same-model comps).
      setListings(annotateDeals(processedListings))
      setSyncStatus('online')
      setLastSync(Date.now())
      setLoading(false)
    } catch (err) {
      console.error("Error fetching listings:", err)
      setSyncStatus('offline')   // real status — no more fake "connected"
    }
  }

  const handleClaim = async (listing_id, operatorName) => {
    if (!operatorName) {
      operatorName = await dialogs.prompt({
        title: 'Assign machinery',
        message: 'Which operator should take this machine?',
        placeholder: 'Operator name',
      });
    }
    if (!operatorName) return;

    try {
      const response = await fetch(`${API_BASE}/claim`, {
        method: 'POST',
        headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ listing_id: listing_id, employee_name: operatorName })
      });
      if (response.ok) {
        toast.success(`Assigned to ${operatorName}.`);
        fetchListings(); // Refresh UI live
      } else {
        toast.error("Failed to assign machinery.");
      }
    } catch (err) {
      console.error("Error assigning:", err);
      toast.error("Couldn't reach the server.");
    }
  };

  // Move a deal to any pipeline stage (Claimed → … → Sold, or Lost + reason).
  const handleStatus = async (listing_id, status, reason = null, changed_by = null) => {
    try {
      const response = await fetch(`${API_BASE}/listings/${listing_id}/status`, {
        method: 'POST',
        headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ listing_id, status, reason, changed_by })
      });
      if (response.ok) {
        toast.success(status === 'Lost' ? 'Marked as lost.' : `Moved to ${status}.`);
        fetchListings();
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(`Failed to update status: ${err.detail || response.status}`);
      }
    } catch (err) {
      console.error("Error updating status:", err);
      toast.error("Couldn't reach the server.");
    }
  };

  const handleRemove = async (listingId) => {
    const reason = await dialogs.prompt({
      title: 'Remove listing',
      message: 'Why are you removing this listing? (kept for the record)',
      placeholder: 'Reason',
    });
    if (!reason) return; // Cancelled or empty

    try {
      const res = await fetch(`${API_BASE}/listings/${listingId}/remove`, {
        method: 'POST',
        headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reason })
      });
      if (res.ok) {
        toast.success('Listing removed.');
        fetchListings(); // Refresh UI
      } else {
        toast.error('Failed to remove listing.');
      }
    } catch (err) {
      console.error("Failed to remove:", err);
      toast.error("Couldn't reach the server.");
    }
  };

  // Validate any stored session on load; expired/revoked tokens drop to login.
  useEffect(() => {
    let alive = true
    verifySession().then((me) => {
      if (!alive) return
      setUser(me)
      setAuthChecked(true)
    })
    return () => { alive = false }
  }, [])

  // Only poll listings once the user is logged in.
  useEffect(() => {
    if (!user) return
    fetchListings()
    const interval = setInterval(fetchListings, 10000) // poll every 10 seconds
    return () => clearInterval(interval)
  }, [user])

  const handleLogout = async () => {
    await authLogout()
    setUser(null)
    setActiveTab('Dashboard')
  }

  // Mascus listings live on their own Sourcing page, not the front Dashboard.
  // Closed deals (Sold/Lost) leave the working views too — Reports keeps them.
  const frontListings = useMemo(
    () => listings.filter(l => l.source !== 'Mascus' && !CLOSED_STATUSES.has(l.status)),
    [listings]
  )

  // Real system health derived from the data + fetch outcome.
  const health = useMemo(() => {
    const now = Date.now()
    let newest = null
    let new24h = 0
    let stale = 0
    for (const it of frontListings) {
      const d = parseUTC(it.timestamp)
      if (!d) continue
      if (!newest || d > newest) newest = d
      const ageDays = (now - d.getTime()) / 86400000
      if (ageDays <= 1) new24h += 1
      if (ageDays > 14) stale += 1
    }
    return { newest, new24h, stale, deals: frontListings.filter(l => l.isDeal).length }
  }, [frontListings])

  // Filtered + searched deployments for the table.
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(frontListings.map(l => l.category).filter(Boolean)))],
    [frontListings]
  )
  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase()
    return frontListings.filter(l => {
      if (categoryFilter !== 'All' && l.category !== categoryFilter) return false
      if (statusFilter !== 'All' && l.status !== statusFilter) return false
      if (q) {
        const hay = `${l.make} ${l.model} ${l.location} ${l.listing_id}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [frontListings, search, categoryFilter, statusFilter])

  // Wait for the session check before deciding login vs. app (avoids a flash).
  if (!authChecked && !user) {
    return <div className="app-wrapper"><div className="hex-bg"></div><div className="bg-flares"></div></div>
  }
  if (!user) {
    return <LoginView onSuccess={(data) => { setUser(data); setAuthChecked(true) }} />
  }

  const manager = isManager()

  return (
    <div className="app-wrapper">
      {/* Background Layers */}
      <div className="hex-bg"></div>
      <div className="bg-flares"></div>

      {/* Main Title Outside the Box */}
      <div className="outer-title-container">
        <h1 className="main-title">HEAVY MACHINERY DISPATCH</h1>
        <h2 className="sub-title">Aeonik</h2>
      </div>

      {/* The Big Glass Dashboard Container */}
      <div className="main-glass-panel">

        {/* Global Dispatch Header */}
        <div className="global-header">
          <div className="header-left">
            <span className="globe-icon"><Icon name="globe" size={22} /></span>
            <span className="title">GLOBAL DISPATCH CENTER</span>
          </div>
          <div className="header-right">
            <button className="add-machine-btn" onClick={() => setShowAdd(true)}><Icon name="plus" size={16} />Add Machine</button>
            {manager && (
              <button className="icon-btn" title="Download a backup of all data" onClick={downloadBackup} disabled={backingUp}>
                <Icon name="download" size={16} />{backingUp ? 'Backing up…' : 'Backup'}
              </button>
            )}
            <span className="user-badge">
              {manager ? '★ ' : ''}{user.name} · {manager ? 'Manager' : 'Operator'}
            </span>
            <button className="icon-btn icon-only" title="Change password" onClick={() => setShowChangePw(true)}><Icon name="key" size={17} /></button>
            <button className="logout-btn" onClick={handleLogout}><Icon name="logout" size={15} />Logout</button>
          </div>
        </div>

        {showAdd && <AddMachineModal onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); fetchListings(); }} />}
        {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}

        {/* Content Area */}
        <div className="content-area">
          
          {/* Sidebar */}
          <div className="sidebar">
            {manager && (
              <div className={`nav-item ${activeTab === 'Overview' ? 'active' : ''}`} onClick={() => setActiveTab('Overview')}>
                <Icon name="overview" className="icon" /> Overview
              </div>
            )}
            <div className={`nav-item ${activeTab === 'My Work' ? 'active' : ''}`} onClick={() => setActiveTab('My Work')}>
              <Icon name="toolbox" className="icon" /> My Work
            </div>
            <div className={`nav-item ${activeTab === 'Dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('Dashboard')}>
              <Icon name="home" className="icon" /> Dashboard
            </div>
            <div className={`nav-item ${activeTab === 'Fleet Status' ? 'active' : ''}`} onClick={() => setActiveTab('Fleet Status')}>
              <Icon name="users" className="icon" /> Fleet Status
            </div>
            <div className={`nav-item ${activeTab === 'Assignments' ? 'active' : ''}`} onClick={() => setActiveTab('Assignments')}>
              <Icon name="clipboard" className="icon" /> Assignments
            </div>
            <div className={`nav-item ${activeTab === 'Live Tracking' ? 'active' : ''}`} onClick={() => setActiveTab('Live Tracking')}>
              <Icon name="pin" className="icon" /> Live Tracking
            </div>
            <div className={`nav-item ${activeTab === 'Sourcing' ? 'active' : ''}`} onClick={() => setActiveTab('Sourcing')}>
              <Icon name="sourcing" className="icon" /> Sourcing
            </div>
            {manager && (
              <div className={`nav-item ${activeTab === 'Stock' ? 'active' : ''}`} onClick={() => setActiveTab('Stock')}>
                <Icon name="stock" className="icon" /> Stock
              </div>
            )}
            {manager && (
              <div className={`nav-item ${activeTab === 'Finance' ? 'active' : ''}`} onClick={() => setActiveTab('Finance')}>
                <Icon name="money" className="icon" /> Finance
              </div>
            )}
            {manager && (
              <div className={`nav-item ${activeTab === 'Buyers' ? 'active' : ''}`} onClick={() => setActiveTab('Buyers')}>
                <Icon name="handshake" className="icon" /> Buyers
              </div>
            )}
            {manager && (
              <div className={`nav-item ${activeTab === 'Reports' ? 'active' : ''}`} onClick={() => setActiveTab('Reports')}>
                <Icon name="reports" className="icon" /> Reports
              </div>
            )}
            {manager && (
              <div className={`nav-item ${activeTab === 'Admin Panel' ? 'active' : ''}`} onClick={() => setActiveTab('Admin Panel')}>
                <Icon name="admin" className="icon" /> Admin Portal
              </div>
            )}
          </div>

          {/* View Controller */}
          <div className="dashboard-content-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeTab === 'Dashboard' && (
              <div className="dashboard-grid">
                
                {/* Inventory Heatmap Widget with Holographic Map */}
                <div className="widget map-widget" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
                  <div className="widget-header">
                    INVENTORY HEATMAP <span className="dots">•••</span>
                  </div>
                  <div className="map-content" style={{ padding: 0, overflow: 'hidden' }}>
                    <MapContainer 
                      center={[39.8283, -98.5795]} 
                      zoom={4} 
                      minZoom={2}
                      maxBounds={[[-90, -180], [90, 180]]}
                      maxBoundsViscosity={1.0}
                      style={{ height: '100%', width: '100%', background: '#050711' }} 
                      zoomControl={false} 
                      attributionControl={false}
                    >
                      {/* Base map: Colorful Realistic Satellite View of Earth */}
                      <TileLayer
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        className="cyber-tiles"
                        noWrap={true}
                      />
                      
                      {/* Glowing Animated Markers from Live Database */}
                      {frontListings.map((item) => {
                        if (item.lat && item.lng && item.lat !== 0) {
                          const colorName = item.colorClass.split('-')[0];
                          return (
                            <Marker key={item.listing_id} position={[item.lat, item.lng]} icon={createGlowIcon(`glow-${colorName}`)}>
                              <Tooltip direction="top" offset={[0, -15]} opacity={1} permanent className="heat-tooltip">
                                {item.location}: {fmtPrice(item.price, item.currency)}
                              </Tooltip>
                            </Marker>
                          )
                        }
                        return null;
                      })}
                    </MapContainer>
                  </div>
                </div>

                {/* Right Side Widgets container */}
                <div className="right-widgets">
                  {/* Fleet Overview Widget */}
                  <div className="widget stats-widget">
                    <div className="widget-header">
                      FLEET OVERVIEW <span className="dots">•••</span>
                    </div>
                    <div className="stat-row">
                      <div className="stat-label">Total Assets</div>
                      <div className="stat-value">{frontListings.length}</div>
                      <div className="stat-ring green"></div>
                    </div>
                    <div className="stat-row">
                      <div className="stat-label">Claimed</div>
                      <div className="stat-value">{frontListings.filter(i => i.status === 'Claimed').length}</div>
                      <div className="stat-ring cyan"></div>
                    </div>
                    <div className="stat-row">
                      <div className="stat-label">Unassigned</div>
                      <div className="stat-value">{frontListings.filter(i => i.status !== 'Claimed').length}</div>
                      <div className="stat-ring purple"></div>
                    </div>
                  </div>

                  {/* System Health Widget (real status) */}
                  <div className="widget alerts-widget">
                    <div className="widget-header">
                      SYSTEM HEALTH <span className="dots">•••</span>
                    </div>
                    <div className={`alert-item ${syncStatus === 'online' ? 'success' : 'danger'}`}>
                      <span className="alert-icon"><Icon name="dot" size={14} /></span>
                      API {syncStatus === 'online' ? 'Online' : (syncStatus === 'offline' ? 'OFFLINE' : 'Connecting…')}
                      <span className={`pulse-dot ${syncStatus === 'online' ? 'green' : 'orange'}`}></span>
                    </div>
                    <div className="alert-item">
                      <span className="alert-icon"><Icon name="clock" size={15} /></span> Last listing: {relativeTime(health.newest)}
                    </div>
                    <div className="alert-item">
                      <span className="alert-icon"><Icon name="sparkle" size={15} /></span> New (24h): {health.new24h}
                    </div>
                    {health.deals > 0 && (
                      <div className="alert-item success">
                        <span className="alert-icon"><Icon name="flame" size={15} /></span> Deals flagged: {health.deals}
                      </div>
                    )}
                    {health.stale > 0 && (
                      <div className="alert-item warning">
                        <span className="alert-icon"><Icon name="alert" size={15} /></span> Stale (&gt;14d): {health.stale}
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Deployments Full-width Table Widget */}
                <div className="widget table-widget">
                  <div className="widget-header">
                    ACTIVE DEPLOYMENTS <span className="dots">•••</span>
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
                    <select className="table-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                      {categories.map(c => <option key={c} value={c}>{c === 'All' ? 'All categories' : c.replace('_', ' ')}</option>)}
                    </select>
                    <select className="table-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                      {['All', ...PIPELINE_STAGES.filter(s => s !== 'Sold')].map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>)}
                    </select>
                    <span className="table-count">{filteredListings.length} / {listings.length}</span>
                  </div>
                  <div className="table-scroll-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>MACHINERY ID</th>
                          <th>MAKE & MODEL</th>
                          <th>PRICE</th>
                          <th>OPERATOR</th>
                          <th>LOCATION</th>
                          <th>STATUS</th>
                          <th>ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading && <SkeletonRows rows={6} cols={7} />}
                        {!loading && filteredListings.map((item) => (
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
                          <td className="price-cell">{fmtPrice(item.price, item.currency)}</td>
                          <td>{item.operator}</td>
                          <td>{item.location}</td>
                          <td>
                            <span className={`status-badge ${item.colorClass}`}>
                              {item.status}
                            </span>
                          </td>
                          <td>
                            {item.status === 'Active' && (
                              <button className="btn-action" onClick={() => handleClaim(item.listing_id)}>
                                Claim/Assign
                              </button>
                            )}
                            {/* Source link always available (pre-claim too) so staff
                                can inspect the machine before claiming. Manual
                                entries have no URL — hide the button then. */}
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noreferrer">
                                <button className="btn-action"><Icon name="link" size={13} />View</button>
                              </a>
                            )}
                            <button className="btn-action remove-btn" onClick={() => handleRemove(item.listing_id)}>
                              <Icon name="trash" size={13} />Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!loading && filteredListings.length === 0 && (
                        <tr><td colSpan="7">
                          <EmptyState
                            icon={listings.length === 0 ? 'excavator' : 'search'}
                            title={listings.length === 0 ? 'No machines yet' : 'No matches'}
                            hint={listings.length === 0
                              ? 'New machines appear here automatically as the harvester finds them.'
                              : 'Try clearing the search or filters.'}
                          />
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                  </div>
                </div>
            )}
            {activeTab === 'Fleet Status' && <FleetStatusView listings={listings} />}
            {activeTab === 'Assignments' && <AssignmentsView listings={listings} handleClaim={handleClaim} handleStatus={handleStatus} />}
            {activeTab === 'Live Tracking' && <LiveTrackingView listings={listings} />}
            {activeTab === 'Sourcing' && (
              <SourcingView
                listings={listings}
                handleClaim={handleClaim}
                handleRemove={handleRemove}
                initialListingId={deepListingId}
              />
            )}
            {activeTab === 'My Work' && <MyWorkView listings={listings} handleClaim={handleClaim} handleStatus={handleStatus} />}
            {activeTab === 'Overview' && manager && <OverviewView listings={listings} />}
            {activeTab === 'Stock' && manager && <StockView />}
            {activeTab === 'Finance' && manager && <FinanceView />}
            {activeTab === 'Buyers' && manager && <BuyersView />}
            {activeTab === 'Reports' && manager && <ReportsView listings={listings} />}
            {activeTab === 'Admin Panel' && manager && <AdminPanelView listings={listings} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
