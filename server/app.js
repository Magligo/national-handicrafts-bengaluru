import express from 'express';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authenticate, authenticateCustomer, clearSession, clearCustomerSession, getCsrfToken, getCustomerCsrfToken, setSession, setCustomerSession, requireAdmin, requireCustomer, optionalCustomer } from './auth.js';
import { createRepository } from './repository.js';
import { productInput, validateOrder, customerRegistrationInput, customerProfileInput, addressInput, adminPasswordChangeInput, orderStatuses } from './validation.js';
import { paymentConfig, serverConfig } from './config/env.js';
import { createRateLimit } from './middleware/rateLimit.js';
import { uploadProductImage } from './storage/cloudinary.js';
import { OAuth2Client } from 'google-auth-library';

const root = path.dirname(fileURLToPath(import.meta.url));
const localDevelopmentOrigins = ['http://localhost:5173', 'http://localhost:5174'];
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 8 }, fileFilter: (_req, file, cb) => /^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG, and WebP images are allowed')) });
function removeUploadedFiles(product) { const paths = [...new Set([product?.image_path, ...(product?.image_paths || [])].filter((value) => typeof value === 'string' && value.startsWith('/uploads/')))]; for (const publicPath of paths) { try { fs.unlinkSync(path.join(root, '..', 'public', publicPath.replace(/^\//, ''))); } catch { /* stale or already removed upload */ } } }
function publicError(error) { if (error?.code === 'LIMIT_FILE_SIZE') return 'Each image must be 5 MB or smaller'; if (error?.code === 'LIMIT_FILE_COUNT') return 'You can upload up to 8 images'; if (/Only (?:image files|JPEG, PNG, and WebP)/i.test(error?.message || '')) return 'Only JPEG, PNG, and WebP images are allowed'; if (/required|must be|between|one of|valid JSON|positive whole|Insufficient stock|No valid products|configured|duplicate|price|Google sign-in/i.test(error?.message || '')) return error.message; return 'Request failed'; }
async function uploadProductImages(files, uploader) { return Promise.all(files.map(async (file) => (await uploader(file)).url)); }
function publicCustomer(customer) { if (!customer) return null; return { id: customer.id, email: customer.email, name: customer.name, avatar_url: customer.avatar_url || '', phone: customer.phone || '', address: customer.address || '', city: customer.city || '', state: customer.state || '', pin: customer.pin || '', created_at: customer.created_at, updated_at: customer.updated_at }; }
export function validateGoogleIdentity(payload, clientId, now = Date.now()) {
  if (!payload || payload.aud !== clientId || !['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss) || payload.email_verified !== true || !payload.sub || !payload.email || !Number.isFinite(Number(payload.exp)) || Number(payload.exp) * 1000 <= now) throw new Error('Google sign-in could not be verified');
  return { google_id: payload.sub, email: payload.email.toLowerCase(), name: payload.name || payload.email.split('@')[0], avatar_url: payload.picture || null };
}

async function verifyGoogleCredential(credential, clientId) {
  if (!clientId) throw new Error('Google sign-in is not configured');
  if (!credential) throw new Error('Google sign-in credential is missing');
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    return validateGoogleIdentity(ticket.getPayload(), clientId);
  } catch (error) {
    if (error?.message === 'Google sign-in could not be verified') throw error;
    throw new Error('Google sign-in could not be verified');
  }
}

export function createApp({ repo = createRepository(), secret = serverConfig.adminSessionSecret, corsOrigin = serverConfig.frontendOrigin, imageUploader = uploadProductImage, googleVerifier = verifyGoogleCredential, googleClientId = serverConfig.googleClientId } = {}) {
  if (process.env.NODE_ENV === 'production' && !secret) throw new Error('ADMIN_SESSION_SECRET is required in production');
  if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_ORIGIN) throw new Error('FRONTEND_ORIGIN is required in production');
  const sessionSecret = secret || 'local-only-change-me';
  const customerSessionSecret = process.env.CUSTOMER_SESSION_SECRET || sessionSecret;
  const app = express();
  const adminLoginRateLimit = createRateLimit({ message: 'Too many failed admin login attempts. Try again later.' });
  const customerLoginRateLimit = createRateLimit({ message: 'Too many failed account login attempts. Try again later.' });
  const orderRateLimit = createRateLimit();
  const allowedOrigins = new Set([corsOrigin, ...(process.env.NODE_ENV === 'production' ? [] : localDevelopmentOrigins)].filter(Boolean));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(path.join(root, '..', 'public', 'uploads')));
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'national-handicrafts-api' }));
  app.get('/api/payment/config', (_req, res) => { const config = paymentConfig(); res.json({ data: config.enabled ? config : { enabled: false } }); });
  app.get('/api/products', async (req, res, next) => { try { res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300'); res.json({ data: await repo.listProducts({ q: req.query.q || '', category: req.query.category || '' }) }); } catch (e) { next(e); } });
  app.get('/api/products/:id', async (req, res, next) => { try { const p = await repo.getProduct(req.params.id); if (!p || !p.active || p.verification_status !== 'verified') return res.status(404).json({ error: 'Product not found' }); res.json({ data: p }); } catch (e) { next(e); } });
  app.post('/api/auth/login', adminLoginRateLimit, async (req, res, next) => { try { const user = await authenticate(req.body?.email || '', req.body?.password || '', repo); if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Invalid admin credentials' }); setSession(res, user, sessionSecret); res.json({ data: user }); } catch (e) { next(e); } });
  const admin = requireAdmin(sessionSecret, repo);
  const adminMutation = requireAdmin(sessionSecret, repo, { csrf: true });
  app.post('/api/auth/logout', adminMutation, (_req, res) => { clearSession(res); res.status(204).end(); });
  app.get('/api/auth/me', admin, (req, res) => res.json({ data: req.admin }));
  app.get('/api/auth/csrf', admin, getCsrfToken);
  app.post('/api/auth/password', adminMutation, async (req, res, next) => { try { const { currentPassword, newPassword } = adminPasswordChangeInput(req.body); if (req.admin.id === 'env-admin') return res.status(409).json({ error: 'Environment-configured admin credentials must be changed in the deployment environment settings.' }); const saved = await repo.findAdminById(req.admin.id); if (!saved || saved.role !== 'admin' || !(await bcrypt.compare(currentPassword, saved.password_hash))) return res.status(401).json({ error: 'Current password is incorrect' }); await repo.updateAdminPassword(req.admin.id, await bcrypt.hash(newPassword, 12)); clearSession(res); res.status(204).end(); } catch (e) { next(e); } });
  const customer = requireCustomer(customerSessionSecret);
  const customerMutation = requireCustomer(customerSessionSecret, { csrf: true });
  app.post('/api/customer/auth/register', customerLoginRateLimit, async (req, res, next) => { try { const input = customerRegistrationInput(req.body); if (await repo.findCustomer(input.email)) return res.status(409).json({ error: 'An account with this email already exists' }); const saved = await repo.createCustomer({ email: input.email, password_hash: await bcrypt.hash(input.password, 12), name: input.name }); const user = { id: saved.id, email: saved.email, role: 'customer' }; setCustomerSession(res, user, customerSessionSecret); res.status(201).json({ data: publicCustomer(saved) }); } catch (e) { next(e); } });
  app.post('/api/customer/auth/login', customerLoginRateLimit, async (req, res, next) => { try { const user = await authenticateCustomer(String(req.body?.email || '').trim(), String(req.body?.password || ''), repo); if (!user) return res.status(401).json({ error: 'Invalid customer credentials' }); const saved = await repo.getCustomer(user.id); setCustomerSession(res, user, customerSessionSecret); res.json({ data: publicCustomer(saved) }); } catch (e) { next(e); } });
  app.post('/api/customer/auth/google', customerLoginRateLimit, async (req, res, next) => { try { const identity = await googleVerifier(String(req.body?.credential || ''), googleClientId); let saved = await repo.findCustomerByGoogleId(identity.google_id); if (!saved) { const emailAccount = await repo.findCustomer(identity.email); if (emailAccount) return res.status(409).json({ error: 'An account with this email already exists. Sign in with your existing email and password before linking Google.' }); saved = await repo.createCustomer({ ...identity, password_hash: null }); } const user = { id: saved.id, email: saved.email, role: 'customer' }; setCustomerSession(res, user, customerSessionSecret); res.json({ data: publicCustomer(saved) }); } catch (e) { console.warn(`[google-auth] ${e.message}`); next(e); } });
  app.post('/api/customer/auth/logout', customerMutation, (_req, res) => { clearCustomerSession(res); res.status(204).end(); });
  app.get('/api/customer/auth/me', customer, async (req, res, next) => { try { const saved = await repo.getCustomer(req.customer.id); if (!saved) return res.status(401).json({ error: 'Customer account not found' }); res.json({ data: publicCustomer(saved) }); } catch (e) { next(e); } });
  app.get('/api/customer/auth/csrf', customer, getCustomerCsrfToken);
  app.get('/api/customer/profile', customer, async (req, res, next) => { try { const saved = await repo.getCustomer(req.customer.id); if (!saved) return res.status(404).json({ error: 'Customer account not found' }); res.json({ data: publicCustomer(saved) }); } catch (e) { next(e); } });
  app.patch('/api/customer/profile', customerMutation, async (req, res, next) => { try { const updated = await repo.updateCustomer(req.customer.id, customerProfileInput(req.body)); if (!updated) return res.status(404).json({ error: 'Customer account not found' }); res.json({ data: publicCustomer(updated) }); } catch (e) { next(e); } });
  app.get('/api/customer/orders', customer, async (req, res, next) => { try { res.json({ data: await repo.listCustomerOrders(req.customer.id) }); } catch (e) { next(e); } });
  app.post('/api/customer/orders/:id/cancellation', customerMutation, async (req, res, next) => { try { const result = await repo.requestCancellation(req.params.id, req.customer.id); if (result.kind === 'missing') return res.status(404).json({ error: 'Order not found' }); if (result.kind === 'ineligible') return res.status(409).json({ error: 'This order is not eligible for cancellation' }); if (result.kind === 'duplicate') return res.status(409).json({ error: 'A cancellation request is already pending review' }); res.status(201).json({ data: result.order }); } catch (e) { next(e); } });
  app.get('/api/customer/addresses', customer, async (req, res, next) => { try { res.json({ data: await repo.listAddresses(req.customer.id) }); } catch (e) { next(e); } });
  app.post('/api/customer/addresses', customerMutation, async (req, res, next) => { try { res.status(201).json({ data: await repo.createAddress(req.customer.id, addressInput(req.body)) }); } catch (e) { next(e); } });
  app.patch('/api/customer/addresses/:id', customerMutation, async (req, res, next) => { try { const updated = await repo.updateAddress(req.params.id, req.customer.id, addressInput(req.body)); if (!updated) return res.status(404).json({ error: 'Address not found' }); res.json({ data: updated }); } catch (e) { next(e); } });
  app.delete('/api/customer/addresses/:id', customerMutation, async (req, res, next) => { try { if (!await repo.deleteAddress(req.params.id, req.customer.id)) return res.status(404).json({ error: 'Address not found' }); res.status(204).end(); } catch (e) { next(e); } });
  app.post('/api/orders', optionalCustomer(customerSessionSecret), orderRateLimit, async (req, res, next) => {
    try {
      validateOrder(req.body);
      const paymentMethod = String(req.body.paymentMethod || 'UPI').toUpperCase();
      const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim().slice(0, 120);
      const existing = await repo.findOrderByIdempotencyKey(idempotencyKey);
      if (existing) return res.status(200).json({ data: existing, duplicate: true });
      const items = [];
      for (const requested of req.body.items) {
        const product = await repo.getProduct(requested.id);
        const quantity = Number(requested.quantity);
        if (!product || !product.active || product.verification_status !== 'verified') continue;
        if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be a positive whole number');
        if (product.stock !== null && quantity > product.stock) throw new Error(`Insufficient stock for ${product.name}`);
        if (product.price_inr == null) throw new Error(`A verified price is required for ${product.name}`);
        items.push({ productId: product.id, name: product.name, quantity, unitPriceInr: product.price_inr, imagePath: product.image_path || null, variant: requested.variant || null });
      }
      if (!items.length) return res.status(400).json({ error: 'No valid products found' });
      const subtotal = items.reduce((sum, item) => sum + item.unitPriceInr * item.quantity, 0);
      const configured = paymentConfig().enabled;
      const saved = await repo.createOrderIdempotently({ customer_id: req.customer?.id || null, customer: req.body.customer, items, subtotal_inr: subtotal, shipping_inr: 0, total_inr: subtotal, payment_method: paymentMethod, payment_status: paymentMethod === 'COD' ? 'pending' : configured ? 'pending' : 'not_configured', payment_reference: null, idempotency_key: idempotencyKey || null, status: 'pending' });
      res.status(saved.duplicate ? 200 : 201).json({ data: saved.order, ...(saved.duplicate ? { duplicate: true } : {}), payment: paymentMethod === 'UPI' && configured ? paymentConfig() : { enabled: false } });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/dashboard', admin, async (_req, res, next) => { try { res.json({ data: await repo.dashboard() }); } catch (e) { next(e); } });
  app.get('/api/admin/products', admin, async (req, res, next) => { try { res.json({ data: await repo.listProducts({ admin: true, q: req.query.q || '', category: req.query.category || '' }) }); } catch (e) { next(e); } });
  app.post('/api/admin/products', adminMutation, upload.array('images', 8), async (req, res, next) => { try { const input = productInput(req.body); const imagePaths = await uploadProductImages(req.files || [], imageUploader); const mainIndex = Math.max(0, Math.min(Number(req.body.mainImageIndex || 0), imagePaths.length - 1)); input.image_paths = imagePaths; input.image_path = imagePaths[mainIndex] || null; res.status(201).json({ data: await repo.createProduct(input) }); } catch (e) { next(e); } });
  app.patch('/api/admin/products/:id', adminMutation, upload.array('images', 8), async (req, res, next) => { try { const input = productInput(req.body, { partial: true }); const imagePaths = await uploadProductImages(req.files || [], imageUploader); if (imagePaths.length) { const mainIndex = Math.max(0, Math.min(Number(req.body.mainImageIndex || 0), imagePaths.length - 1)); input.image_paths = imagePaths; input.image_path = imagePaths[mainIndex]; } const updated = await repo.updateProduct(req.params.id, input); if (!updated) return res.status(404).json({ error: 'Product not found' }); res.json({ data: updated }); } catch (e) { next(e); } });
  app.post('/api/admin/products/:id/publish', adminMutation, async (req, res, next) => { try { const updated = await repo.updateProduct(req.params.id, { verification_status: 'verified', active: true }); if (!updated) return res.status(404).json({ error: 'Product not found' }); res.json({ data: updated }); } catch (e) { next(e); } });
  app.post('/api/admin/products/:id/unpublish', adminMutation, async (req, res, next) => { try { const updated = await repo.updateProduct(req.params.id, { active: false }); if (!updated) return res.status(404).json({ error: 'Product not found' }); res.json({ data: updated }); } catch (e) { next(e); } });
  app.delete('/api/admin/products/:id', adminMutation, async (req, res, next) => { try { const product = await repo.getProduct(req.params.id); if (!product || !await repo.deleteProduct(req.params.id)) return res.status(404).json({ error: 'Product not found' }); removeUploadedFiles(product); res.status(204).end(); } catch (e) { next(e); } });
  app.get('/api/admin/orders', admin, async (_req, res, next) => { try { res.json({ data: await repo.listOrders() }); } catch (e) { next(e); } });
  app.get('/api/admin/payment-settings', admin, (_req, res) => res.json({ data: paymentConfig() }));
  app.patch('/api/admin/orders/:id/status', adminMutation, async (req, res, next) => { try { if (!orderStatuses.includes(req.body?.status)) return res.status(400).json({ error: 'Invalid order status' }); const order = await repo.updateOrderStatus(req.params.id, req.body.status); if (!order) return res.status(404).json({ error: 'Order not found' }); if (order.invalidTransition) return res.status(409).json({ error: 'This order status transition is not allowed' }); res.json({ data: order }); } catch (e) { next(e); } });
  app.post('/api/admin/orders/:id/payment/collect-cod', adminMutation, async (req, res, next) => { try { const order = await repo.markCodCollected(req.params.id, req.admin.email); if (!order) return res.status(409).json({ error: 'COD payment is already collected or this is not a COD order' }); res.json({ data: order }); } catch (e) { next(e); } });
  app.post('/api/admin/orders/:id/cancellation/:decision', adminMutation, async (req, res, next) => { try { if (!['approved','rejected'].includes(req.params.decision)) return res.status(400).json({ error: 'Decision must be approved or rejected' }); const order = await repo.decideCancellation(req.params.id, req.params.decision); if (!order) return res.status(409).json({ error: 'No pending cancellation request exists' }); res.json({ data: order }); } catch (e) { next(e); } });
  app.post('/api/admin/orders/:id/payment/verify', adminMutation, async (req, res, next) => { try { if (!req.body?.evidenceNote || String(req.body.evidenceNote).trim().length < 3) return res.status(400).json({ error: 'Evidence note is required for manual verification' }); const order = await repo.verifyPayment(req.params.id, { payment_status: 'verified', payment_verified_at: new Date().toISOString(), payment_verified_by: req.admin.email, payment_evidence_note: String(req.body.evidenceNote).trim().slice(0, 500) }); if (!order) return res.status(404).json({ error: 'Order not found' }); res.json({ data: order }); } catch (e) { next(e); } });
  app.use((err, _req, res, _next) => { if (err?.status === 503) return res.status(503).json({ error: err.message }); console.error(err); res.status(err.status || 400).json({ error: publicError(err) }); });
  return { app, repo };
}
