/** Create a small in-process limiter for login and order bursts. Failed responses consume a slot. */
export function createRateLimit({ max = 10, windowMs = 15 * 60 * 1000, message = 'Too many requests. Try again later.', countSuccessful = false } = {}) {
  const attempts = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    recent.push(now);
    attempts.set(key, recent);
    res.once('finish', () => {
      if (!countSuccessful && res.statusCode < 400) {
        const current = attempts.get(key) || [];
        const index = current.indexOf(now);
        if (index >= 0) current.splice(index, 1);
        if (current.length) attempts.set(key, current); else attempts.delete(key);
      }
    });
    next();
  };
}
