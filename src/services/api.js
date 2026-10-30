import { API, API_ORIGIN, ASSET_ORIGIN } from '../config/api.js';
import { NEUTRAL_IMAGE_FALLBACK, resolveImageUrl } from './image.js';
import { formatPrice } from './currency.js';

export { API, API_ORIGIN, ASSET_ORIGIN };
export { formatPrice };

/** Perform a same-origin-capable API request and return the parsed response body. */
export async function api(path, options = {}) {
  const { timeout = 12000, signal: callerSignal, ...requestOptions } = options;
  const service = path.includes('/auth/') ? 'authentication' : 'catalogue';
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  const timeoutId = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  let response;
  try {
    response = await fetch(`${API}${path}`, { credentials: 'include', ...requestOptions, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new Error(`The ${service} service is taking too long to respond. Please try again.`);
    }
    throw new Error(`Unable to reach the ${service} service. Please try again.`);
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }

  let body = null;
  try {
    body = response.status === 204 ? null : await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new Error(body?.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
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
  return path ? resolveImageUrl(path, ASSET_ORIGIN) : NEUTRAL_IMAGE_FALLBACK;
}
