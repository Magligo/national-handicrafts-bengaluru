import { api } from './api.js';

const requestTimeoutMs = 30000;
const retryDelaysMs = [1200, 3000];
const cacheKey = 'national-handicrafts-public-catalogue-v1';
const cacheTtlMs = 15000;
let inFlightProducts = null;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isRetryable = (error) => !error?.status || [408, 429, 500, 502, 503, 504].includes(error.status);

/** Read a very short-lived snapshot containing only the public verified API response. */
export function readCachedProducts(storage = null, now = Date.now()) {
  try {
    storage ||= globalThis.localStorage;
    const cached = JSON.parse(storage?.getItem(cacheKey) || 'null');
    if (cached?.version !== 1 || !Number.isFinite(cached.savedAt) || now - cached.savedAt > cacheTtlMs || !Array.isArray(cached.data)) return null;
    return cached.data.filter((product) => product?.active === true && product?.verification_status === 'verified');
  } catch {
    return null;
  }
}

export function cacheProducts(products, storage = null, now = Date.now()) {
  if (!Array.isArray(products)) return;
  try { storage ||= globalThis.localStorage; storage?.setItem(cacheKey, JSON.stringify({ version: 1, savedAt: now, data: products })); } catch { /* Storage may be disabled or full. */ }
}

/** Load verified products with bounded retries while sharing any in-flight request. */
export function loadProducts({ request = api, pause = wait, onTiming = null } = {}) {
  if (inFlightProducts) return inFlightProducts;

  const pending = (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const startedAt = globalThis.performance?.now?.() ?? Date.now();
        const response = await request('/products', { timeout: requestTimeoutMs, headers: { 'X-Request-ID': requestId } });
        try { (onTiming || ((timing) => console.info('[catalogue] Frontend request completed', timing)))({ requestId, durationMs: Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt) }); } catch { /* Instrumentation must not affect loading. */ }
        return response;
      } catch (error) {
        if (!isRetryable(error) || attempt >= retryDelaysMs.length) throw error;
        await pause(retryDelaysMs[attempt]);
      }
    }
  })();

  const wrapped = pending.finally(() => {
    if (inFlightProducts === wrapped) inFlightProducts = null;
  });
  inFlightProducts = wrapped;
  return wrapped;
}
