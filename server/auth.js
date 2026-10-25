import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

const cookieName = 'nh_admin_token';
const csrfCookieName = 'nh_csrf';
const customerCookieName = 'nh_customer_token';
const customerCsrfCookieName = 'nh_customer_csrf';
export class AdminConfigurationError extends Error {
  constructor(message) { super(message); this.name = 'AdminConfigurationError'; this.status = 503; }
}
function sign(value, secret) { return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`; }
function verify(token, secret) { const [value, sig] = String(token || '').split('.'); if (!value || !sig) return null; const expected = createHmac('sha256', secret).update(value).digest('base64url'); const actual = Buffer.from(sig); const expectedBuffer = Buffer.from(expected); return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer) ? value : null; }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').filter(Boolean).map((part) => { const [key, ...value] = part.trim().split('='); return [key, value.join('=')]; })); }
function sameSecret(a, b) { const left = Buffer.from(String(a || '')); const right = Buffer.from(String(b || '')); return left.length === right.length && left.length > 0 && timingSafeEqual(left, right); }
function environmentAdminCredentials() {
  const email = String(process.env.ADMIN_EMAIL || '').trim();
  const passwordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  if (!email && !passwordHash) return null;
  if (!email || !passwordHash) throw new AdminConfigurationError('Admin authentication is partially configured. Set both ADMIN_EMAIL and ADMIN_PASSWORD_HASH.');
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) throw new AdminConfigurationError('ADMIN_PASSWORD_HASH must be a valid bcrypt hash.');
  return { email, passwordHash };
}
export async function authenticate(email, password, repo) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const configured = environmentAdminCredentials();
  const user = await repo.findAdmin(normalizedEmail);
  if (user) {
    if (user.role === 'admin' && await bcrypt.compare(String(password || ''), user.password_hash)) return { id: user.id, email: user.email, role: 'admin' };
    return null;
  }
  if (configured && normalizedEmail === configured.email.toLowerCase() && await bcrypt.compare(String(password || ''), configured.passwordHash)) return { id: 'env-admin', email: configured.email, role: 'admin' };
  if (!user && !configured) throw new AdminConfigurationError('Admin authentication is not configured. Add an admin account or set ADMIN_EMAIL and ADMIN_PASSWORD_HASH.');
  return null;
}
export async function authenticateCustomer(email, password, repo) { const user = await repo.findCustomer(email); if (!user || !(await bcrypt.compare(password, user.password_hash))) return null; return { id: user.id, email: user.email, role: 'customer' }; }
export function setSession(res, user, secret) { const value = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url'); const csrf = randomBytes(32).toString('base64url'); res.setHeader('Set-Cookie', [`${cookieName}=${sign(value, secret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`, `${csrfCookieName}=${csrf}; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`]); }
export function clearSession(res) { res.setHeader('Set-Cookie', [`${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`, `${csrfCookieName}=; SameSite=Lax; Path=/; Max-Age=0`]); }
export function getCsrfToken(req, res) { const token = parseCookies(req.headers.cookie)[csrfCookieName] || randomBytes(32).toString('base64url'); res.setHeader('Set-Cookie', `${csrfCookieName}=${token}; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); res.json({ data: { token } }); }
export function requireAdmin(secret, { csrf = false } = {}) { return (req, res, next) => { const cookies = parseCookies(req.headers.cookie); const raw = verify(cookies[cookieName], secret); if (!raw) return res.status(401).json({ error: 'Admin authentication required' }); try { const user = JSON.parse(Buffer.from(raw, 'base64url').toString()); if (user.exp < Date.now()) throw new Error(); if (user.role !== 'admin') return res.status(403).json({ error: 'Administrator role required' }); if (csrf && !sameSecret(req.headers['x-csrf-token'], cookies[csrfCookieName])) return res.status(403).json({ error: 'CSRF validation failed' }); req.admin = user; next(); } catch (error) { if (error?.status === 403) return res.status(403).json({ error: error.message }); return res.status(401).json({ error: 'Admin session expired' }); } }; }
export function setCustomerSession(res, user, secret) { const value = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url'); const csrf = randomBytes(32).toString('base64url'); res.setHeader('Set-Cookie', [`${customerCookieName}=${sign(value, secret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`, `${customerCsrfCookieName}=${csrf}; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`]); }
export function clearCustomerSession(res) { res.setHeader('Set-Cookie', [`${customerCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`, `${customerCsrfCookieName}=; SameSite=Lax; Path=/; Max-Age=0`]); }
export function getCustomerCsrfToken(req, res) { const token = parseCookies(req.headers.cookie)[customerCsrfCookieName] || randomBytes(32).toString('base64url'); res.setHeader('Set-Cookie', `${customerCsrfCookieName}=${token}; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); res.json({ data: { token } }); }
export function requireCustomer(secret, { csrf = false } = {}) { return (req, res, next) => { const cookies = parseCookies(req.headers.cookie); const raw = verify(cookies[customerCookieName], secret); if (!raw) return res.status(401).json({ error: 'Customer authentication required' }); try { const user = JSON.parse(Buffer.from(raw, 'base64url').toString()); if (user.exp < Date.now()) throw new Error(); if (csrf && !sameSecret(req.headers['x-csrf-token'], cookies[customerCsrfCookieName])) return res.status(403).json({ error: 'CSRF validation failed' }); req.customer = user; next(); } catch (error) { if (error?.status === 403) return res.status(403).json({ error: error.message }); return res.status(401).json({ error: 'Customer session expired' }); } }; }
export function optionalCustomer(secret) { return (req, res, next) => { const cookies = parseCookies(req.headers.cookie); const raw = verify(cookies[customerCookieName], secret); if (!raw) return res.status(401).json({ error: 'Customer authentication required' }); try { const user = JSON.parse(Buffer.from(raw, 'base64url').toString()); if (user.exp < Date.now()) return res.status(401).json({ error: 'Customer session expired' }); req.customer = user; next(); } catch { return res.status(401).json({ error: 'Customer authentication required' }); } }; }
