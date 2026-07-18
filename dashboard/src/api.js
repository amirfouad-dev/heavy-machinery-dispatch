// Central place for the API base URL and auth header.
// Set VITE_API_BASE_URL and (optionally) VITE_API_KEY in the dashboard's .env.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const API_KEY = import.meta.env.VITE_API_KEY;

// Merge the X-API-Key header (when configured) with any extra headers.
export const authHeaders = (extra = {}) => {
  const headers = { ...extra };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
};
