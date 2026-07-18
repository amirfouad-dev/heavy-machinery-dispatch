import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { API_BASE } from '../api';
import { withAuth, getUser } from '../auth';
import Icon from '../ui/icons';
import EmptyState from '../ui/EmptyState';
import { dialogs, toast } from '../ui/feedback';
import { CHART_AXIS, CHART_GRID, CHART_TOOLTIP, CHART_COLORS } from '../ui/chart';

const AdminPanelView = ({ listings }) => {
  const [users, setUsers] = useState([]);
  const [newUserName, setNewUserName] = useState('');
  const [newRole, setNewRole] = useState('Operator');
  const [newPassword, setNewPassword] = useState('');
  const [newCommission, setNewCommission] = useState('');

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/users`, { headers: withAuth() });
      const data = await response.json();
      setUsers(data.users || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUserName) return;
    try {
      await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: newUserName, role: newRole,
          password: newPassword || null,
          commission_pct: newCommission ? Number(newCommission) : 0,
        })
      });
      setNewUserName(''); setNewPassword(''); setNewCommission(''); setNewRole('Operator');
      fetchUsers();
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetPassword = async (u) => {
    const pw = await dialogs.prompt({ title: 'Reset password', message: `Set a new password for ${u.name}`, placeholder: 'New password' });
    if (!pw) return;
    const res = await fetch(`${API_BASE}/users/${u.id}/reset-password`, {
      method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) toast.success(`Password updated for ${u.name}.`);
    else toast.error('Failed to reset password.');
  };

  const handleEditUser = async (u, patch) => {
    const res = await fetch(`${API_BASE}/users/${u.id}`, {
      method: 'PUT', headers: withAuth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.detail || 'Failed to update user.');
    }
    fetchUsers();
    return res.ok;
  };

  // Role picker per row. Demoting a manager needs a confirmation — a stray
  // click here once locked the whole company out of the money views (the
  // server also refuses to demote the LAST manager as a hard backstop).
  const changeRole = async (u, newRole) => {
    const current = (u.role || 'Operator').toLowerCase();
    if (newRole.toLowerCase() === current) return;
    if (current === 'manager') {
      const isSelf = u.name === getUser()?.name;
      const ok = await dialogs.confirm({
        title: 'Demote to Operator',
        message: isSelf
          ? 'You are about to demote YOURSELF. You will immediately lose access to Finance, Admin, and all money pages.'
          : `Demote ${u.name} from Manager to Operator? They will lose access to the money pages.`,
        danger: true, confirmText: 'Demote',
      });
      if (!ok) { fetchUsers(); return; } // reset the select to the real value
    } else {
      const ok = await dialogs.confirm({
        title: 'Promote to Manager',
        message: `Make ${u.name} a Manager? They will see Finance, profit, buyers and the Admin Portal.`,
        confirmText: 'Promote',
      });
      if (!ok) { fetchUsers(); return; }
    }
    if (await handleEditUser(u, { role: newRole })) {
      toast.success(`${u.name} is now ${newRole}.`);
    }
  };

  const editCommission = async (u) => {
    const val = await dialogs.prompt({
      title: 'Set commission',
      message: `Commission % for ${u.name} (share of profit on deals they close)`,
      defaultValue: String(u.commission_pct || 0),
    });
    if (val === null) return;
    handleEditUser(u, { commission_pct: Number(val) || 0 });
    toast.success(`Commission set to ${Number(val) || 0}% for ${u.name}.`);
  };

  const handleDeleteUser = async (u) => {
    const ok = await dialogs.confirm({
      title: 'Remove user',
      message: `Remove ${u.name}? They will lose access immediately.`,
      danger: true, confirmText: 'Remove',
    });
    if (!ok) return;
    try {
      await fetch(`${API_BASE}/users/${u.id}`, { method: 'DELETE', headers: withAuth() });
      toast.success(`${u.name} removed.`);
      fetchUsers();
    } catch (e) {
      console.error(e);
      toast.error("Couldn't reach the server.");
    }
  };

  // Process data for Sales Infographic
  const salesData = useMemo(() => {
    const completedListings = listings.filter(l => l.status === 'Completed');
    let totalSpent = 0;
    const makeCount = {};
    const sourceCount = {};

    completedListings.forEach(item => {
      if (item.price && item.price !== 'Call for Price') {
        const numeric = parseFloat(item.price.replace(/[^0-9.]/g, ''));
        if (!isNaN(numeric)) {
          totalSpent += numeric;
        }
      }
      makeCount[item.make] = (makeCount[item.make] || 0) + 1;
      sourceCount[item.source] = (sourceCount[item.source] || 0) + 1;
    });

    const makeChartData = Object.keys(makeCount).map(key => ({ name: key, count: makeCount[key] }));
    const sourceChartData = Object.keys(sourceCount).map(key => ({ name: key, count: sourceCount[key] }));

    return { completedListings, totalSpent, makeChartData, sourceChartData };
  }, [listings]);

  return (
    <div className="view-container admin-view">
      <div className="view-header">
        <h2>ADMIN PORTAL</h2>
        <p>User management and Completed Purchases Dashboard.</p>
      </div>

      <div className="admin-grid">
        {/* User Management Section */}
        <div className="admin-panel user-management">
          <h3>USER MANAGEMENT</h3>
          <form className="add-user-form" onSubmit={handleAddUser} style={{ flexWrap: 'wrap', gap: 8 }}>
            <input type="text" placeholder="Name…" value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)} className="cyber-input" />
            <select className="cyber-input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="Operator">Operator</option>
              <option value="Manager">Manager</option>
            </select>
            <input type="text" placeholder="Password (optional)" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} className="cyber-input" />
            <input type="number" placeholder="Comm %" value={newCommission}
              onChange={(e) => setNewCommission(e.target.value)} className="cyber-input" style={{ maxWidth: 90 }} />
            <button type="submit" className="cyber-button">ADD USER</button>
          </form>

          <div className="table-scroll-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>NAME</th>
                <th>TELEGRAM</th>
                <th>ROLE</th>
                <th>COMM %</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td>
                    {u.telegram_chat_id ? (
                      <span className="status-badge green-theme">Linked</span>
                    ) : (
                      <span className="status-badge yellow-theme">Pending…</span>
                    )}
                  </td>
                  <td>
                    <select
                      className={`role-select ${(u.role || '').toLowerCase() === 'manager' ? 'role-manager' : ''}`}
                      value={(u.role || 'Operator').toLowerCase() === 'manager' ? 'Manager' : 'Operator'}
                      onChange={(e) => changeRole(u, e.target.value)}
                      aria-label={`Role for ${u.name}`}
                    >
                      <option value="Operator">Operator</option>
                      <option value="Manager">Manager</option>
                    </select>
                  </td>
                  <td>{u.commission_pct ? `${u.commission_pct}%` : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-action" onClick={() => handleResetPassword(u)}><Icon name="key" size={13} />PW</button>
                    <button className="btn-action" onClick={() => editCommission(u)}><Icon name="money" size={13} />Comm</button>
                    <button className="delete-btn" onClick={() => handleDeleteUser(u)}>REMOVE</button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan="5"><EmptyState compact icon="users" title="No users yet" hint="Add your first team member above." /></td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Sales Dashboard Section */}
        <div className="admin-panel sales-dashboard">
          <h3>SALES & ACQUISITIONS INFOGRAPHIC</h3>
          
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-title">TOTAL COMPLETED BUYINGS</div>
              <div className="kpi-value">{salesData.completedListings.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-title">CAPITAL DEPLOYED</div>
              <div className="kpi-value">${salesData.totalSpent.toLocaleString()}</div>
            </div>
          </div>

          <div className="charts-grid">
            <div className="chart-container">
              <h3>PURCHASED BY MAKE</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={salesData.makeChartData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                  <XAxis dataKey="name" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} allowDecimals={false} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Bar dataKey="count" fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} maxBarSize={46} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-container">
              <h3>PURCHASED BY SOURCE</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={salesData.sourceChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="count" stroke="none">
                    {salesData.sourceChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...CHART_TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#8a97b8' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanelView;
