import { API, API_ORIGIN } from '../config/api.js';

export { API, API_ORIGIN };

/** Perform a same-origin-capable API request and return the parsed response body. */
export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, { credentials: 'include', ...options });
  } catch {
    throw new Error(`Unable to reach the catalogue API at ${API}. Start the backend on port 4000 and try again.`);
  }

  let body = null;
  try {
    body = response.status === 204 ? null : await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(body?.error || 'The request could not be completed.');
  return body;
}

export async function authenticateAccount({ email, password }) {
  const credentials = { email, password };
  try {
    const adminResponse = await api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (adminResponse?.data?.role === 'admin') return { role: 'admin', data: adminResponse.data };
  } catch {
    // An admin login failure is expected for normal customer credentials.
  }

  try {
    const customerResponse = await api('/customer/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    return { role: 'customer', data: customerResponse?.data };
  } catch (error) {
    if (error.message === 'Invalid customer credentials') throw new Error('Invalid email or password.');
    throw error;
  }
}

export function imageUrl(path) {
  return path?.startsWith('/uploads') ? `${API_ORIGIN}${path}` : path;
}

export function formatPrice(price) {
  return price == null ? 'Price on request' : `\u20B9${Number(price).toLocaleString('en-IN')}`;
}
