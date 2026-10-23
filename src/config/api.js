const configuredApi = import.meta.env.VITE_API_URL?.trim() || 'http://localhost:4000/api';

export const API = configuredApi.replace(/\/+$/, '').endsWith('/api')
  ? configuredApi.replace(/\/+$/, '')
  : `${configuredApi.replace(/\/+$/, '')}/api`;

export const API_ORIGIN = API.replace(/\/api\/?$/, '');
