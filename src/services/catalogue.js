import { api } from './api.js';

const requestTimeoutMs = 30000;
const retryDelaysMs = [1200, 3000];
let inFlightProducts = null;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isRetryable = (error) => !error?.status || [408, 429, 500, 502, 503, 504].includes(error.status);

/** Load verified products with bounded retries while sharing any in-flight request. */
export function loadProducts({ request = api, pause = wait } = {}) {
  if (inFlightProducts) return inFlightProducts;

  const pending = (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request('/products', { timeout: requestTimeoutMs });
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
