// Login/session state for the dashboard (Phase 4).
// Token is kept in localStorage; every API call sends it as a Bearer header.
// Server enforces roles — the UI gating here is convenience, not the security.
import { API_BASE } from './api';

const TOKEN_KEY = 'hmd_token';
const USER_KEY = 'hmd_user';

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
};

export const isManager = () => !!getUser()?.is_manager;

const store = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

const clear = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export const login = async (name, password) => {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Login failed (${res.status})`);
  }
  const data = await res.json();
  store(data.token, { name: data.name, role: data.role, is_manager: data.is_manager });
  return data;
};

export const logout = async () => {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
  } catch { /* ignore network error on logout */ }
  clear();
};

// Merge auth (Bearer) + API key + any extra headers for authenticated calls.
export const withAuth = (extra = {}) => {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const apiKey = import.meta.env.VITE_API_KEY;
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
};

// Verify the stored token is still valid on app load (expired/revoked -> logout).
export const verifySession = async () => {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { clear(); return null; }
    const me = await res.json();
    store(token, { name: me.name, role: me.role, is_manager: me.is_manager });
    return me;
  } catch {
    return getUser(); // network blip: trust cached user rather than lock out
  }
};
