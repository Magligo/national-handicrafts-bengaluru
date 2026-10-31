import express from 'express';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authenticate, authenticateCustomer, clearSession, clearCustomerSession, getCsrfToken, getCustomerCsrfToken, setSession, setCustomerSession, requireAdmin, requireCustomer, optionalCustomer } from './auth.js';
import { createRepository } from './repository.js';
import { productInput, validateOrder, customerRegistrationInput, customerProfileInput, addressInput, adminPasswordChangeInput, orderStatuses, validateCustomerPassword } from './validation.js';
import { getConfiguredFrontendOrigins, paymentConfig, serverConfig } from './config/env.js';
import { createRateLimit } from './middleware/rateLimit.js';
import { uploadProductImage, uploadShopBannerMedia } from './storage/cloudinary.js';
import { OAuth2Client } from 'google-auth-library';
import { createHash, randomBytes } from 'node:crypto';
import { sendPasswordResetEmail, emailDeliveryConfigured } from './email/resend.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const localDevelopmentOrigins = ['http://localhost:5173', 'http://localhost:5174'];
const projectVercelPreviewOrigin = /^https:\/\/national-handicrafts-bengaluru-(?:[a-z0-9]{6,}|git-[a-z0-9]+(?:-[a-z0-9]+)*)-magligo\.vercel\.app$/i;
const corsMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const corsHeaders = ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'];
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 8 }, fileFilter: (_req, file, cb) => /^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG, and WebP images are allowed')) });
const bannerUpload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => (/^image\/(jpeg|png|webp)$/.test(file.mimetype) || /^video\/(mp4|webm)$/.test(file.mimetype)) ? cb(null, true) : cb(new Error('Banner media must be JPEG, PNG, WebP, MP4, or WebM')) });
function removeUploadedFiles(product) { const paths = [...new Set([product?.image_path, ...(product?.image_paths || [])].filter((value) => typeof value === 'string' && value.startsWith('/uploads/')))]; for (const publicPath of paths) { try { fs.unlinkSync(path.join(root, '..', 'public', publicPath.replace(/^\//, ''))); } catch { /* stale or already removed upload */ } } }
function publicError(error, requestPath = '') { if (error?.code === 'LIMIT_FILE_SIZE') return requestPath.includes('/shop-banners') ? 'Banner media must be 50 MB or smaller' : 'Each image must be 5 MB or smaller'; if (error?.code === 'LIMIT_FILE_COUNT') return requestPath.includes('/shop-banners') ? 'Upload one banner media file at a time' : 'You can upload up to 8 images'; if (/Only (?:image files|JPEG, PNG, and WebP)/i.test(error?.message || '')) return 'Only JPEG, PNG, and WebP images are allowed'; if (/Banner media must be JPEG/i.test(error?.message || '')) return error.message; if (/required|must be|between|one of|valid JSON|positive whole|Insufficient stock|No valid products|configured|duplicate|price|Google sign-in|available|option|awaiting|verified|quantity/i.test(error?.message || '')) return error.message; return 'Request failed'; }
function isTransientDatabaseError(error) { const code = String(error?.code || ''); return /^(08|ECONN|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|57P01|53300)/.test(code) || /^(ConnectionTimeoutError|ConnectionError)$/.test(error?.name || '') || /query (?:read )?timeout|timeout exceeded when trying to connect|connection terminated unexpectedly/i.test(error?.message || ''); }
function validBannerLink(value) { return !value || /^https:\/\/\S+$/i.test(value) || /^\/(?!\/)[^\s]*$/.test(value); }
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

export function createApp({ repo = createRepository(), secret = serverConfig.adminSessionSecret, corsOrigin, imageUploader = uploadProductImage, bannerUploader = uploadShopBannerMedia, googleVerifier = verifyGoogleCredential, googleClientId = serverConfig.googleClientId, passwordResetMailer = null } = {}) {
  if (process.env.NODE_ENV === 'production' && !secret) throw new Error('ADMIN_SESSION_SECRET is required in production');
  const configuredOrigins = getConfiguredFrontendOrigins(corsOrigin);
  if (process.env.NODE_ENV === 'production' && configuredOrigins.length === 0) throw new Error('FRONTEND_ORIGINS or FRONTEND_ORIGIN is required in production');
  const sessionSecret = secret || 'local-only-change-me';
  const customerSessionSecret = process.env.CUSTOMER_SESSION_SECRET || sessionSecret;
  const app = express();
  const adminLoginRateLimit = createRateLimit({ message: 'Too many failed admin login attempts. Try again later.' });
  const customerLoginRateLimit = createRateLimit({ message: 'Too many failed account login attempts. Try again later.' });
  const passwordResetRateLimit = createRateLimit({ max: 5, countSuccessful: true, message: 'Too many password reset requests. Try again later.' });
  const passwordResetTokenRateLimit = createRateLimit({ max: 10, countSuccessful: true, message: 'Too many password reset attempts. Try again later.' });
  const orderRateLimit = createRateLimit();
  const allowedOrigins = new Set([...configuredOrigins, ...(process.env.NODE_ENV === 'production' ? [] : localDevelopmentOrigins)]);
  const isAllowedOrigin = (origin) => allowedOrigins.has(origin) || projectVercelPreviewOrigin.test(origin);
  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin && !isAllowedOrigin(origin)) return res.status(403).json({ error: 'Origin not allowed' });
    next();
  });
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
    credentials: true,
    methods: corsMethods,
    allowedHeaders: corsHeaders,
    optionsSuccessStatus: 204,
    maxAge: 600,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(path.join(root, '..', 'public', 'uploads')));
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'national-handicrafts-api' }));
  app.get('/api/payment/config', (_req, res) => { const config = paymentConfig(); res.json({ data: config.enabled ? config : { enabled: false } }); });
  const publicProduct = (product) => {
    const specifications = product.specifications || {};
    const publicSpecs = specifications.sourceReviewStatus === 'verified' ? { ...specifications } : {};
    if (!publicSpecs.countryOfOriginVerified) { delete publicSpecs.countryOfOrigin; delete publicSpecs.countryOfOriginVerified; }
    const variants = (Array.isArray(product.variants) ? product.variants : []).map((variant) => {
      const verified = variant.source_review_status === 'verified';
      const { price, ...fields } = variant;
      if (!verified) return { id: variant.id, name: 'Option awaiting review', price_inr: null, stock: null, availability: 'enquiry', source_review_status: 'needs_review' };
      return { ...fields, price_inr: variant.price_inr ?? price ?? null, source_review_status: 'verified' };
    });
    return { ...product, price_inr: variants.length ? null : product.price_inr, stock: variants.length ? null : product.stock, variants, specifications: publicSpecs };
  };
  app.get('/api/products', async (req, res, next) => {
    const startedAt = Date.now();
    try {
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      const products = (await repo.listProducts({ q: req.query.q || '', category: req.query.category || '' })).map(publicProduct);
      const durationMs = Date.now() - startedAt;
      if (durationMs >= 3000) console.info('[catalogue] Product list completed slowly', { durationMs, count: products.length });
      res.json({ data: products });
    } catch (error) {
      console.warn('[catalogue] Product list failed', { durationMs: Date.now() - startedAt, code: error.code || 'application_error', name: error.name || 'Error' });
      next(error);
    }
  });
  app.get('/api/products/:id', async (req, res, next) => { try { const p = await repo.getProduct(req.params.id); if (!p || !p.active || p.verification_status !== 'verified') return res.status(404).json({ error: 'Product not found' }); res.json({ data: publicProduct(p) }); } catch (e) { next(e); } });
  app.post('/api/auth/login', adminLoginRateLimit, async (req, res, next) => { try { const user = await authenticate(req.body?.email || '', req.body?.password || '', repo); if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Invalid admin credentials' }); setSession(res, user, sessionSecret); res.json({ data: user }); } catch (e) { next(e); } });
  const admin = requireAdmin(sessionSecret, repo);
  const adminMutation = requireAdmin(sessionSecret, repo, { csrf: true });
  app.post('/api/auth/logout', adminMutation, (_req, res) => { clearSession(res); res.status(204).end(); });
  app.get('/api/auth/me', admin, (req, res) => res.json({ data: req.admin }));
  app.get('/api/auth/csrf', admin, getCsrfToken);
  app.post('/api/auth/password', adminMutation, async (req, res, next) => { try { const { currentPassword, newPassword } = adminPasswordChangeInput(req.body); if (req.admin.id === 'env-admin') return res.status(409).json({ error: 'Environment-configured admin credentials must be changed in the deployment environment settings.' }); const saved = await repo.findAdminById(req.admin.id); if (!saved || saved.role !== 'admin' || !(await bcrypt.compare(currentPassword, saved.password_hash))) return res.status(401).json({ error: 'Current password is incorrect' }); await repo.updateAdminPassword(req.admin.id, await bcrypt.hash(newPassword, 12)); clearSession(res); res.status(204).end(); } catch (e) { next(e); } });
  const customer = requireCustomer(customerSessionSecret, repo);
  const customerMutation = requireCustomer(customerSessionSecret, repo, { csrf: true });
  app.post('/api/customer/auth/register', customerLoginRateLimit, async (req, res, next) => { try { const input = customerRegistrationInput(req.body); if (await repo.findCustomer(input.email)) return res.status(409).json({ error: 'An account with this email already exists' }); const saved = await repo.createCustomer({ email: input.email, password_hash: await bcrypt.hash(input.password, 12), name: input.name }); const user = { id: saved.id, email: saved.email, role: 'customer', sessionVersion: Number(saved.session_version || 0) }; setCustomerSession(res, user, customerSessionSecret); res.status(201).json({ data: publicCustomer(saved) }); } catch (e) { next(e); } });
  app.post('/api/customer/auth/login', customerLoginRateLimit, async (req, res, next) => { try { const user = await authenticateCustomer(String(req.body?.email || '').trim(), String(req.body?.password || ''), repo); if (!user) return res.status(401).json({ error: 'Invalid customer credentials' }); const saved = await repo.getCustomer(user.id); setCustomerSession(res, user, customerSessionSecret); res.json({ data: publicCustomer(saved) }); } catch (e) { next(e); } });
  const genericResetMessage = 'If an account exists for that email and password recovery is configured, reset instructions will be sent.';
  app.post('/api/customer/auth/password/forgot', passwordResetRateLimit, async (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const configured = typeof passwordResetMailer === 'function' || emailDeliveryConfigured();
      const customerRecord = configured && /^\S+@\S+\.\S+$/.test(email) ? await repo.findCustomer(email) : null;
      if (customerRecord) {
        const token = randomBytes(32).toString('base64url');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        await repo.saveCustomerPasswordReset(email, tokenHash, new Date(Date.now() + 30 * 60 * 1000).toISOString());
        const origin = String(process.env.FRONTEND_ORIGIN || serverConfig.frontendOrigin).replace(/\/$/, '');
        const resetUrl = `${origin}/?page=password-reset&token=${encodeURIComponent(token)}`;
        try { await (passwordResetMailer || sendPasswordResetEmail)({ email, name: customerRecord.name, resetUrl }); }
        catch { await repo.clearCustomerPasswordReset(tokenHash); console.warn('[password-reset] email delivery unavailable'); }
      }
      res.status(202).json({ message: genericResetMessage });
    } catch (error) { next(error); }
  });
  app.post('/api/customer/auth/password/reset', passwordResetTokenRateLimit, async (req, res, next) => {
    try {
      const token = String(req.body?.token || '');
      const password = validateCustomerPassword(req.body?.password);
      if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(400).json({ error: 'This password reset link is invalid or expired. Request a new link.' });
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const updated = await repo.resetCustomerPassword(tokenHash, await bcrypt.hash(password, 12));
      if (!updated) return res.status(400).json({ error: 'This password reset link is invalid or expired. Request a new link.' });
      clearCustomerSession(res);
      res.json({ message: 'Your password has been reset. Sign in with your new password.' });
    } catch (error) { next(error); }
  });
  app.post('/api/customer/auth/google', customerLoginRateLimit, async (req, res, next) => { try { const identity = await googleVerifier(String(req.body?.credential || ''), googleClientId); let saved = await repo.findCustomerByGoogleId(identity.google_id); if (!saved) { const emailAccount = await repo.findCustomer(identity.email); if (emailAccount) return res.status(409).json({ error: 'An account with this email already exists. Sign in with your existing email and password before linking Google.' }); saved = await repo.createCustomer({ ...identity, password_hash: null }); } const user = { id: saved.id, email: saved.email, role: 'customer', sessionVersion: Number(saved.session_version || 0) }; setCustomerSession(res, user, customerSessionSecret); res.json({ data: publicCustomer(saved) }); } catch (e) { console.warn(`[google-auth] ${e.message}`); next(e); } });
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
  app.post('/api/orders', optionalCustomer(customerSessionSecret, repo), orderRateLimit, async (req, res, next) => {
    try {
      validateOrder(req.body);
      const paymentMethod = String(req.body.paymentMethod || 'UPI').toUpperCase();
      const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim().slice(0, 120);
      const configured = paymentConfig().enabled;
      const saved = await repo.createOrderWithInventory({ customer_id: req.customer?.id || null, customer: req.body.customer, requestedItems: req.body.items, shipping_inr: 0, payment_method: paymentMethod, payment_status: paymentMethod === 'COD' ? 'pending' : configured ? 'pending' : 'not_configured', payment_reference: null, idempotency_key: idempotencyKey || null, status: 'pending' });
      res.status(saved.duplicate ? 200 : 201).json({ data: saved.order, ...(saved.duplicate ? { duplicate: true } : {}), payment: paymentMethod === 'UPI' && configured ? paymentConfig() : { enabled: false } });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/dashboard', admin, async (_req, res, next) => { try { res.json({ data: await repo.dashboard() }); } catch (e) { next(e); } });
  app.get('/api/shop-banners', async (_req, res, next) => { try { res.json({ data: await repo.listShopBanners({ activeOnly: true }) }); } catch (e) { next(e); } });
  app.get('/api/admin/shop-banners', admin, async (_req, res, next) => { try { res.json({ data: await repo.listShopBanners() }); } catch (e) { next(e); } });
  app.post('/api/admin/shop-banners', adminMutation, bannerUpload.single('media'), async (req, res, next) => {
    try {
      const requestKey = String(req.get('Idempotency-Key') || '').trim();
      if (requestKey.length > 120) return res.status(400).json({ error: 'Idempotency key must be 120 characters or fewer' });
      const creationKey = requestKey ? `${req.admin.id}:${requestKey}` : null;
      if (creationKey) {
        const existing = await repo.getShopBannerByCreationKey(creationKey);
        if (existing) return res.status(200).json({ data: existing, duplicate: true });
      }
      if (!req.file) return res.status(400).json({ error: 'Choose an image or video for the banner' });
      if (req.file.mimetype.startsWith('image/') && req.file.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'Banner images must be 5 MB or smaller' });
      const title = String(req.body?.title || '').trim().slice(0, 120);
      const linkUrl = String(req.body?.linkUrl || '').trim();
      if (!validBannerLink(linkUrl)) return res.status(400).json({ error: 'Banner link must use HTTPS or a site-relative path' });
      const uploaded = await bannerUploader(req.file);
      const input = { title, link_url: linkUrl || null, media_url: uploaded.url, media_type: uploaded.mediaType || (req.file.mimetype.startsWith('video/') ? 'video' : 'image'), active: req.body?.active !== 'false', order_index: Number(req.body?.orderIndex) || 0 };
      if (creationKey) {
        const result = await repo.createShopBannerIdempotently(input, creationKey);
        return res.status(result.duplicate ? 200 : 201).json({ data: result.banner, ...(result.duplicate ? { duplicate: true } : {}) });
      }
      res.status(201).json({ data: await repo.createShopBanner(input) });
    } catch (e) { next(e); }
  });
  app.patch('/api/admin/shop-banners/:id', adminMutation, async (req, res, next) => {
    try {
      const input = {};
      if (req.body?.title !== undefined) input.title = String(req.body.title).trim().slice(0, 120);
      if (req.body?.linkUrl !== undefined) {
        const linkUrl = String(req.body.linkUrl || '').trim();
        if (!validBannerLink(linkUrl)) return res.status(400).json({ error: 'Banner link must use HTTPS or a site-relative path' });
        input.link_url = linkUrl || null;
      }
      if (req.body?.active !== undefined) input.active = req.body.active === true || req.body.active === 'true';
      if (req.body?.orderIndex !== undefined) input.order_index = Math.max(0, Number(req.body.orderIndex) || 0);
      const banner = await repo.updateShopBanner(req.params.id, input);
      if (!banner) return res.status(404).json({ error: 'Shop banner not found' });
      res.json({ data: banner });
    } catch (e) { next(e); }
  });
  app.delete('/api/admin/shop-banners/:id', adminMutation, async (req, res, next) => { try { if (!await repo.deleteShopBanner(req.params.id)) return res.status(404).json({ error: 'Shop banner not found' }); res.status(204).end(); } catch (e) { next(e); } });
  app.get('/api/admin/products', admin, async (req, res, next) => { try { res.json({ data: await repo.listProducts({ admin: true, q: req.query.q || '', category: req.query.category || '' }) }); } catch (e) { next(e); } });
  app.post('/api/admin/products', adminMutation, upload.array('images', 8), async (req, res, next) => {
    try {
      const requestKey = String(req.get('Idempotency-Key') || '').trim();
      if (requestKey.length > 120) return res.status(400).json({ error: 'Idempotency key must be 120 characters or fewer' });
      const creationKey = requestKey ? `${req.admin.id}:${requestKey}` : null;
      if (creationKey) {
        const existing = await repo.getProductByCreationKey(creationKey);
        if (existing) return res.status(200).json({ data: existing, duplicate: true });
      }
      const input = productInput(req.body);
      const imagePaths = await uploadProductImages(req.files || [], imageUploader);
      const mainIndex = Math.max(0, Math.min(Number(req.body.mainImageIndex || 0), imagePaths.length - 1));
      input.image_paths = imagePaths;
      input.image_path = imagePaths[mainIndex] || null;
      if (creationKey) {
        const result = await repo.createProductIdempotently(input, creationKey);
        return res.status(result.duplicate ? 200 : 201).json({ data: result.product, ...(result.duplicate ? { duplicate: true } : {}) });
      }
      res.status(201).json({ data: await repo.createProduct(input) });
    } catch (e) { next(e); }
  });
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
  app.use((err, req, res, _next) => {
    if (isTransientDatabaseError(err)) return res.status(503).json({ error: 'The service is temporarily unavailable. Please try again.' });
    if (err?.status === 503 || err?.status === 502) return res.status(err.status).json({ error: err.message });
    if ((err.status || 400) >= 500) console.error('[api] Request failed', { method: req.method, path: req.path, status: err.status || 500, code: err.code || 'application_error', name: err.name || 'Error' });
    if (err?.code === '23505' && err?.constraint === 'products_sku_key') return res.status(409).json({ error: 'A product with this SKU already exists. Choose a unique product code.' });
    res.status(err.status || 400).json({ error: publicError(err, req.path) });
  });
  return { app, repo };
}
