const cacheTag = 'public-catalogue';

/** Mark Vercel's shared public catalogue cache stale after a product mutation. */
export async function invalidateVercelCatalogueCache({ env = process.env, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const token = env.VERCEL_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    logger.warn('[catalogue] Vercel CDN tag invalidation is not configured; the edge cache will refresh on its next stale request');
    return false;
  }

  const params = new URLSearchParams({ projectIdOrName: projectId, ...(env.VERCEL_TEAM_ID ? { teamId: env.VERCEL_TEAM_ID } : {}) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(`https://api.vercel.com/v1/edge-cache/invalidate-by-tags?${params}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [cacheTag], target: 'production' }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn('[catalogue] Vercel CDN invalidation failed', { status: response.status });
      return false;
    }
    logger.info('[catalogue] Vercel CDN cache marked stale', { tag: cacheTag });
    return true;
  } catch (error) {
    logger.warn('[catalogue] Vercel CDN invalidation failed', { name: error?.name || 'Error' });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
