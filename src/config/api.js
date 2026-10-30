const configuredApi = import.meta.env.VITE_API_URL?.trim();

// Proxy production API traffic through the storefront origin so browsers keep
// the customer session cookie even when third-party cookies are restricted.
const apiBase = import.meta.env.PROD ? '/api' : configuredApi || 'http://localhost:4000/api';

const configuredAssetOrigin = import.meta.env.VITE_ASSET_ORIGIN?.trim();
const productionAssetOrigin = 'https://national-handicrafts-bengaluru.onrender.com';

export const API = apiBase.replace(/\/+$/, '').endsWith('/api')
  ? apiBase.replace(/\/+$/, '')
  : `${apiBase.replace(/\/+$/, '')}/api`;

export const API_ORIGIN = API.replace(/\/api\/?$/, '');
export const ASSET_ORIGIN = configuredAssetOrigin || (import.meta.env.PROD ? productionAssetOrigin : API_ORIGIN);
