const configuredApi = import.meta.env.VITE_API_URL?.trim();

if (!configuredApi && import.meta.env.PROD) {
  throw new Error('VITE_API_URL must be configured for production builds.');
}

const apiBase = configuredApi || 'http://localhost:4000/api';

export const API = apiBase.replace(/\/+$/, '').endsWith('/api')
  ? apiBase.replace(/\/+$/, '')
  : `${apiBase.replace(/\/+$/, '')}/api`;

export const API_ORIGIN = API.replace(/\/api\/?$/, '');
