import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildOrderItems, restoreLinesFromOrder } from './inventory.js';

const { Pool } = pg;
const productFields = ['sku', 'creation_idempotency_key', 'name', 'category', 'description', 'price_inr', 'discount_percent', 'variants', 'specifications', 'stock', 'unit', 'dimensions', 'weight', 'material', 'finish', 'availability', 'image_path', 'image_paths', 'image_public_ids', 'source_catalogue', 'source_page', 'verification_status', 'active'];

async function changeLockedInventory(client, lockedProducts, items, direction) {
  const byId = new Map(lockedProducts.map((product) => [String(product.id), product]));
  const changed = new Set();
  for (const item of items) {
    if (direction < 0 && !item.stockDeducted) continue;
    const product = byId.get(String(item.productId));
    if (!product) {
      if (direction < 0) throw new Error('A selected product is no longer available. Refresh the catalogue and try again.');
      continue;
    }
    if (item.variantId) {
      let found = false;
      product.variants = (Array.isArray(product.variants) ? product.variants : []).map((variant) => {
        if (variant.id !== item.variantId) return variant;
        found = true;
        if (variant.stock == null) {
          if (direction < 0) throw new Error(`Stock for the selected option of ${product.name} has not been confirmed`);
          return variant;
        }
        const nextStock = Number(variant.stock) + direction * Number(item.quantity);
        if (nextStock < 0) throw new Error(`Insufficient stock for ${product.name}${variant.name ? ` (${variant.name})` : ''}`);
        return { ...variant, stock: nextStock };
      });
      if (!found && direction < 0) throw new Error(`The selected option for ${product.name} is no longer available`);
      if (found) changed.add(String(product.id));
    } else {
      if (product.stock == null) {
        if (direction < 0 && item.stockDeducted) throw new Error(`Stock for ${product.name} has changed. Refresh the catalogue and try again.`);
        continue;
      }
      const nextStock = Number(product.stock) + direction * Number(item.quantity);
      if (nextStock < 0) throw new Error(`Insufficient stock for ${product.name}`);
      product.stock = nextStock;
      changed.add(String(product.id));
    }
  }
  for (const id of changed) {
    const product = byId.get(id);
    await client.query('UPDATE products SET stock=$1,variants=$2,updated_at=NOW() WHERE id=$3', [product.stock, JSON.stringify(product.variants || []), product.id]);
  }
}

async function lockProductsForItems(client, items) {
  const ids = [...new Set(items.map((item) => String(item?.id || item?.productId || '')))];
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return [];
  if (!ids.length) return [];
  const result = await client.query('SELECT * FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
  return result.rows;
}

function calculateCouponDiscount(coupon, subtotal) {
  if (coupon.discount_type === 'percentage') return Math.min(subtotal, Number(coupon.max_discount_inr ?? Infinity), Math.round(subtotal * Number(coupon.discount_value) / 100));
  if (coupon.discount_type === 'fixed') return Math.min(subtotal, Number(coupon.discount_value));
  return 0;
}
async function checkCouponEligibility(client, coupon, items, subtotal, customerId, email, { lock = false } = {}) {
  if (!coupon.active) throw new Error('This coupon is inactive');
  const now = Date.now(); if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) throw new Error('This coupon is not active yet'); if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) throw new Error('This coupon has expired');
  if (subtotal < Number(coupon.min_order_inr || 0)) throw new Error(`Minimum order value is ₹${coupon.min_order_inr}`);
  let eligibleSubtotal=subtotal;
  if (coupon.applicability === 'products') { const eligible=new Set(coupon.applicable_product_ids||[]); eligibleSubtotal=items.reduce((n,i)=>n+(eligible.has(i.productId)?i.unitPriceInr*i.quantity:0),0); if(!eligibleSubtotal) throw new Error('Cart does not contain eligible products'); }
  if (coupon.applicability === 'categories') { const p=await client.query('SELECT id,category FROM products WHERE id=ANY($1::uuid[])', [items.map(i=>i.productId)]); const byId=new Map(p.rows.map(x=>[x.id,x.category])); const eligible=new Set(coupon.applicable_categories||[]); eligibleSubtotal=items.reduce((n,i)=>n+(eligible.has(byId.get(i.productId))?i.unitPriceInr*i.quantity:0),0); if(!eligibleSubtotal) throw new Error('Cart does not contain eligible categories'); }
  const usage=await client.query('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ($2::uuid IS NOT NULL AND customer_id=$2) OR ($3::text IS NOT NULL AND customer_email=$3))::int AS customer_count FROM coupon_usages WHERE coupon_id=$1', [coupon.id,customerId||null,email?String(email).toLowerCase():null]);
  if(coupon.total_usage_limit && usage.rows[0].total>=coupon.total_usage_limit) throw new Error('This coupon has reached its usage limit');
  if(usage.rows[0].customer_count>=Number(coupon.per_customer_limit||1)) throw new Error('You have reached this coupon’s usage limit');
  if(coupon.first_order_only && customerId) { const prior=await client.query("SELECT 1 FROM orders WHERE customer_id=$1 AND status<>'cancelled' LIMIT 1",[customerId]); if(prior.rowCount) throw new Error('This coupon is for first orders only'); }
  return eligibleSubtotal;
}

async function restorePostgresOrderInventory(client, order) {
  if (order.inventory_restored_at) return false;
  const lines = restoreLinesFromOrder(order);
  if (!lines.length) return false;
  const products = await lockProductsForItems(client, lines);
  await changeLockedInventory(client, products, lines, 1);
  await client.query('UPDATE orders SET inventory_restored_at=NOW() WHERE id=$1 AND inventory_restored_at IS NULL', [order.id]);
  order.inventory_restored_at = new Date().toISOString();
  return true;
}

export class MemoryRepository {
  constructor(seed = {}) { this.products = [...(seed.products || [])]; this.shopBanners = [...(seed.shopBanners || [])]; this.galleryImages = [...(seed.galleryImages || [])]; this.orders = [...(seed.orders || [])]; this.coupons = [...(seed.coupons || [])]; this.adminUsers = [...(seed.adminUsers || [])]; this.customers = [...(seed.customers || [])]; this.addresses = [...(seed.addresses || [])]; this.orderLock = Promise.resolve(); }
  async listShopBanners({ activeOnly = false } = {}) { return this.shopBanners.filter((banner) => !activeOnly || banner.active).sort((a, b) => Number(a.order_index) - Number(b.order_index) || new Date(a.created_at || 0) - new Date(b.created_at || 0)); }
  async listGalleryImages({ publishedOnly = false } = {}) { return this.galleryImages.filter((image) => !publishedOnly || image.published).sort((a, b) => Number(a.order_index) - Number(b.order_index) || new Date(a.created_at || 0) - new Date(b.created_at || 0) || String(a.id).localeCompare(String(b.id))); }
  async createGalleryImage(input) { const image = { id: randomUUID(), published: false, order_index: this.galleryImages.length, description: '', category: 'General', media_type: 'photo', ...input, image_url: input.image_url ?? input.media_url ?? null, media_url: input.media_url ?? input.image_url ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.galleryImages.push(image); return image; }
  async updateGalleryImage(id, input) { const image = this.galleryImages.find((item) => item.id === id); if (!image) return null; Object.assign(image, input, { updated_at: new Date().toISOString() }); return image; }
  async getGalleryImage(id) { return this.galleryImages.find((item) => item.id === id) || null; }
  async deleteGalleryImage(id) { const before = this.galleryImages.length; this.galleryImages = this.galleryImages.filter((item) => item.id !== id); return this.galleryImages.length < before; }
  async createShopBanner(input) { const banner = { id: randomUUID(), active: true, order_index: this.shopBanners.length, ...input, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.shopBanners.push(banner); return banner; }
  async getShopBannerByCreationKey(key) { return key ? this.shopBanners.find((banner) => banner.creation_idempotency_key === key) || null : null; }
  async createShopBannerIdempotently(input, key) { const existing = this.shopBanners.find((banner) => banner.creation_idempotency_key === key); if (existing) return { banner: existing, duplicate: true }; const banner = { id: randomUUID(), active: true, order_index: this.shopBanners.length, ...input, creation_idempotency_key: key, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.shopBanners.push(banner); return { banner, duplicate: false }; }
  async updateShopBanner(id, input) { const banner = this.shopBanners.find((item) => item.id === id); if (!banner) return null; Object.assign(banner, input, { updated_at: new Date().toISOString() }); return banner; }
  async deleteShopBanner(id) { const before = this.shopBanners.length; this.shopBanners = this.shopBanners.filter((item) => item.id !== id); return this.shopBanners.length < before; }
  async isCloudinaryAssetReferenced(publicId, url, exclude = {}) { const references = (item) => item.id !== exclude.id && ((Boolean(publicId) && ((item.image_public_ids || []).includes(publicId) || item.storage_public_id === publicId || item.thumbnail_storage_public_id === publicId)) || (Boolean(url) && (item.media_url === url || item.image_url === url || item.image_path === url || item.thumbnail_url === url || (item.image_paths || []).includes(url)))); return [...this.products, ...this.shopBanners, ...this.galleryImages].some(references); }
  async listProducts({ admin = false, q = '', category = '' } = {}) { const needle = q.trim().toLowerCase(); return this.products.filter((p) => (admin || (p.active && p.verification_status === 'verified')) && (!category || p.category === category) && (!needle || `${p.name} ${p.category} ${p.sku || ''}`.toLowerCase().includes(needle))).sort((a, b) => a.name.localeCompare(b.name)); }
  async getProduct(id) { return this.products.find((p) => p.id === id) || null; }
  async getProductByCreationKey(key) { return key ? this.products.find((p) => p.creation_idempotency_key === key) || null : null; }
  async createProduct(input) { const p = { id: randomUUID(), image_paths: [], image_public_ids: [], ...input, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.products.push(p); return p; }
  async createProductIdempotently(input, key) { const existing = this.products.find((product) => product.creation_idempotency_key === key); if (existing) return { product: existing, duplicate: true }; const product = { id: randomUUID(), image_paths: [], image_public_ids: [], ...input, creation_idempotency_key: key, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.products.push(product); return { product, duplicate: false }; }
  async updateProduct(id, input) { const p = await this.getProduct(id); if (!p) return null; Object.assign(p, input, { updated_at: new Date().toISOString() }); return p; }
  async deleteProduct(id) { const before = this.products.length; this.products = this.products.filter((p) => p.id !== id); return this.products.length < before; }
  async listCoupons() { return [...(this.coupons || [])]; }
  async createCoupon(input) { this.coupons ||= []; const coupon = { id: randomUUID(), active: true, ...input, code: String(input.code).trim().toUpperCase(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; if (this.coupons.some((c) => c.code === coupon.code)) throw new Error('Coupon code already exists'); this.coupons.push(coupon); return coupon; }
  async updateCoupon(id, input) { const c = (this.coupons || []).find((item) => item.id === id); if (!c) return null; Object.assign(c, input, { code: String(input.code || c.code).trim().toUpperCase(), updated_at: new Date().toISOString() }); return c; }
  async deleteCoupon(id) { this.coupons ||= []; const before = this.coupons.length; this.coupons = this.coupons.filter((c) => c.id !== id); return this.coupons.length < before; }
  async couponUsage(id) { return (this.orders || []).filter((o) => o.coupon_id === id || o.couponId === id).map((o) => ({ order_id: o.id, customer_id: o.customer_id, discount_inr: o.discount_inr, created_at: o.created_at })); }
  async validateCoupon(code, requestedItems, customerId, email) {
    const coupon = (this.coupons || []).find((c) => c.code === String(code).trim().toUpperCase());
    if (!coupon) throw new Error('Coupon code is invalid');
    if (!coupon.active) throw new Error('This coupon is inactive');
    const now = Date.now(); if (coupon.starts_at && new Date(coupon.starts_at) > now) throw new Error('This coupon is not active yet'); if (coupon.expires_at && new Date(coupon.expires_at) <= now) throw new Error('This coupon has expired');
    const items = buildOrderItems(this.products, requestedItems); const subtotal = items.reduce((s, i) => s + i.unitPriceInr * i.quantity, 0);
    if (subtotal < Number(coupon.min_order_inr || 0)) throw new Error(`Minimum order value is ₹${coupon.min_order_inr}`);
    let eligibleSubtotal=subtotal;
    if (coupon.applicability === 'products') { eligibleSubtotal=items.reduce((s,i)=>s+(coupon.applicable_product_ids.includes(i.productId)?i.unitPriceInr*i.quantity:0),0); if(!eligibleSubtotal) throw new Error('Cart does not contain eligible products'); }
    if (coupon.applicability === 'categories') { eligibleSubtotal=items.reduce((s,i)=>s+(coupon.applicable_categories.includes(this.products.find(p=>p.id===i.productId)?.category)?i.unitPriceInr*i.quantity:0),0); if(!eligibleSubtotal) throw new Error('Cart does not contain eligible categories'); }
    const prior = this.orders.filter((o) => o.coupon_code === coupon.code);
    if (coupon.total_usage_limit && prior.length >= coupon.total_usage_limit) throw new Error('This coupon has reached its usage limit');
    if (coupon.first_order_only && this.orders.some((o) => String(o.customer_id) === String(customerId) && o.status !== 'cancelled')) throw new Error('This coupon is for first orders only');
    const usedByCustomer = prior.filter((o) => (customerId && String(o.customer_id) === String(customerId)) || (email && String(o.customer?.email || '').toLowerCase() === String(email).toLowerCase())).length;
    if (usedByCustomer >= Number(coupon.per_customer_limit || 1)) throw new Error('You have reached this coupon’s usage limit');
    const discount = coupon.discount_type === 'percentage' ? Math.min(Math.round(eligibleSubtotal * Number(coupon.discount_value) / 100), coupon.max_discount_inr == null ? Infinity : Number(coupon.max_discount_inr)) : coupon.discount_type === 'fixed' ? Number(coupon.discount_value) : 0;
    return { coupon, subtotal, discount_inr: Math.min(eligibleSubtotal, Math.max(0, discount)), shipping_inr: 0 };
  }
  async findAdmin(email) { return this.adminUsers.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null; }
  async findAdminById(id) { return this.adminUsers.find((u) => u.id === id) || null; }
  async updateAdminPassword(id, passwordHash) { const user = await this.findAdminById(id); if (!user) return null; user.password_hash = passwordHash; user.session_version = Number(user.session_version || 0) + 1; return user; }
  async findOrderByIdempotencyKey(key) { return key ? this.orders.find((order) => order.idempotency_key === key) || null : null; }
  async createOrder(order) { const saved = { id: `NH-${Date.now()}-${randomUUID().slice(0, 6)}`, shipping_inr: 0, ...order, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.orders.unshift(saved); return saved; }
  async createOrderIdempotently(order) {
    const existing = order.idempotency_key && this.orders.find((item) => item.idempotency_key === order.idempotency_key);
    if (existing) return { order: existing, duplicate: true };
    const saved = { id: `NH-${Date.now()}-${randomUUID().slice(0, 6)}`, shipping_inr: 0, ...order, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    this.orders.unshift(saved);
    return { order: saved, duplicate: false };
  }
  async createOrderWithInventory(order) {
    const operation = this.orderLock.then(async () => {
      const existing = order.idempotency_key && this.orders.find((item) => item.idempotency_key === order.idempotency_key);
      if (existing) return { order: existing, duplicate: true };
      const items = buildOrderItems(this.products, order.requestedItems);
      const subtotal = items.reduce((sum, item) => sum + item.unitPriceInr * item.quantity, 0);
      let discount = 0; let coupon = null;
      if (order.coupon_code) { const checked = await this.validateCoupon(order.coupon_code, order.requestedItems, order.customer_id, order.customer?.email); coupon = checked.coupon; discount = checked.discount_inr; }
      const { requestedItems: _requestedItems, ...orderFields } = order;
      const saved = { id: `NH-${Date.now()}-${randomUUID().slice(0, 6)}`, shipping_inr: 0, ...orderFields, coupon_id: coupon?.id || null, coupon_code: coupon?.code || null, discount_inr: discount, items, subtotal_inr: subtotal, total_inr: Math.max(0, subtotal - discount), inventory_restored_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      for (const item of items) if (item.stockDeducted) {
        const product = this.products.find((candidate) => candidate.id === item.productId);
        if (item.variantId) {
          product.variants = product.variants.map((variant) => variant.id === item.variantId ? { ...variant, stock: Number(variant.stock) - item.quantity } : variant);
        } else product.stock = Number(product.stock) - item.quantity;
      }
      this.orders.unshift(saved);
      return { order: saved, duplicate: false };
    });
    this.orderLock = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async findCustomer(email) { return this.customers.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null; }
  async findCustomerByGoogleId(googleId) { return this.customers.find((u) => u.google_id === googleId) || null; }
  async createCustomer(input) { const customer = { id: randomUUID(), ...input, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.customers.push(customer); return customer; }
  async getCustomer(id) { return this.customers.find((customer) => customer.id === id) || null; }
  async updateCustomer(id, input) { const customer = await this.getCustomer(id); if (!customer) return null; Object.assign(customer, input, { updated_at: new Date().toISOString() }); return customer; }
  async saveCustomerPasswordReset(email, tokenHash, expiresAt) { const customer = await this.findCustomer(email); if (!customer) return null; customer.password_reset_token_hash = tokenHash; customer.password_reset_expires_at = expiresAt; return customer; }
  async clearCustomerPasswordReset(tokenHash) { const customer = this.customers.find((item) => item.password_reset_token_hash === tokenHash); if (customer) { customer.password_reset_token_hash = null; customer.password_reset_expires_at = null; } }
  async resetCustomerPassword(tokenHash, passwordHash, now = Date.now()) { const customer = this.customers.find((item) => item.password_reset_token_hash === tokenHash && new Date(item.password_reset_expires_at).getTime() > now); if (!customer) return null; customer.password_hash = passwordHash; customer.password_reset_token_hash = null; customer.password_reset_expires_at = null; customer.session_version = Number(customer.session_version || 0) + 1; return customer; }
  async listCustomerOrders(customerId) { return this.orders.filter((order) => order.customer_id === customerId); }
  async restoreInventory(order) { if (order.inventory_restored_at) return; const lines = restoreLinesFromOrder(order); if (!lines.length) return; for (const line of lines) { const product = this.products.find((candidate) => candidate.id === line.productId); if (!product) continue; if (line.variantId) product.variants = (product.variants || []).map((variant) => variant.id === line.variantId && variant.stock != null ? { ...variant, stock: Number(variant.stock) + Number(line.quantity) } : variant); else if (product.stock != null) product.stock = Number(product.stock) + Number(line.quantity); } order.inventory_restored_at = new Date().toISOString(); }
  async requestCancellation(id, customerId) { const operation = this.orderLock.then(async () => { const order = this.orders.find((item) => item.id === id && item.customer_id === customerId); if (!order) return { kind: 'missing' }; if (['delivered','completed','cancelled'].includes(order.status)) return { kind: 'ineligible' }; if (order.cancellation_request_status === 'pending') return { kind: 'duplicate' }; if (order.status === 'shipped') { order.cancellation_request_status = 'pending'; order.cancellation_requested_at = new Date().toISOString(); } else { await this.restoreInventory(order); order.status = 'cancelled'; order.cancellation_request_status = 'approved'; order.cancellation_requested_at = new Date().toISOString(); } order.updated_at = new Date().toISOString(); return { kind: 'ok', order }; }); this.orderLock = operation.then(() => undefined, () => undefined); return operation; }
  async decideCancellation(id, decision) { const operation = this.orderLock.then(async () => { const order = this.orders.find((item) => item.id === id && item.cancellation_request_status === 'pending'); if (!order) return null; if (decision === 'approved') { await this.restoreInventory(order); order.status = 'cancelled'; } else order.status = 'shipped'; order.cancellation_request_status = decision; order.cancellation_decided_at = new Date().toISOString(); order.updated_at = new Date().toISOString(); return order; }); this.orderLock = operation.then(() => undefined, () => undefined); return operation; }
  async listAddresses(customerId) { return this.addresses.filter((address) => address.customer_id === customerId).sort((a, b) => Number(b.is_default) - Number(a.is_default)); }
  async createAddress(customerId, input) { if (input.is_default) this.addresses.filter((address) => address.customer_id === customerId).forEach((address) => { address.is_default = false; }); const address = { id: randomUUID(), customer_id: customerId, ...input, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.addresses.push(address); return address; }
  async updateAddress(id, customerId, input) { const address = this.addresses.find((item) => item.id === id && item.customer_id === customerId); if (!address) return null; if (input.is_default) this.addresses.filter((item) => item.customer_id === customerId).forEach((item) => { item.is_default = false; }); Object.assign(address, input, { updated_at: new Date().toISOString() }); return address; }
  async deleteAddress(id, customerId) { const before = this.addresses.length; this.addresses = this.addresses.filter((item) => !(item.id === id && item.customer_id === customerId)); return this.addresses.length < before; }
  async listOrders() { return this.orders; }
  async updateOrderStatus(id, status) { const operation = this.orderLock.then(async () => { const order = this.orders.find((o) => o.id === id); if (!order) return null; const allowed = { enquiry:['pending','confirmed','cancelled'], pending:['confirmed','processing','cancelled'], confirmed:['processing','shipped','cancelled'], processing:['shipped','cancelled'], packed:['shipped','cancelled'], shipped:['delivered'], delivered:['completed'], completed:[], cancelled:[] }; if (order.status !== status && !allowed[order.status]?.includes(status)) return { invalidTransition: true }; if (order.status !== 'cancelled' && status === 'cancelled') await this.restoreInventory(order); order.status = status; order.updated_at = new Date().toISOString(); return order; }); this.orderLock = operation.then(() => undefined, () => undefined); return operation; }
  async markCodCollected(id, adminEmail) { const order = this.orders.find((o) => o.id === id && String(o.payment_method).toUpperCase() === 'COD' && o.payment_status === 'pending'); if (!order) return null; Object.assign(order, { payment_status: 'verified', payment_verified_at: new Date().toISOString(), payment_verified_by: adminEmail, payment_evidence_note: 'Cash collected on delivery' }); return order; }
  async verifyPayment(id, verification) { const order = this.orders.find((o) => o.id === id); if (!order) return null; Object.assign(order, verification, { updated_at: new Date().toISOString() }); return order; }
  async dashboard() { return { totalProducts: this.products.length, publishedProducts: this.products.filter((p) => p.active && p.verification_status === 'verified').length, pendingProducts: this.products.filter((p) => p.verification_status === 'pending').length, draftProducts: this.products.filter((p) => !p.active || p.verification_status === 'rejected').length, totalOrders: this.orders.length, recentOrders: this.orders.slice(0, 5) }; }
  async close() {}
}

export class PostgresRepository {
  constructor(connectionString = process.env.DATABASE_URL) {
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30000,
      // Neon can need several seconds to wake after inactivity. Keep acquisition
      // bounded, but allow a cold connection and first catalogue query to finish.
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 20000),
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 20000),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    let loggedFirstConnection = false;
    this.pool.on('connect', () => { if (loggedFirstConnection) return; loggedFirstConnection = true; console.info('[database] First pooled connection established'); });
    this.pool.on('error', (error) => console.warn('[database] Idle pooled client failed', { code: error.code || 'unknown', name: error.name || 'Error' }));
  }
  async query(text, values) { return this.pool.query(text, values); }
  async listCoupons() { return (await this.query('SELECT c.*,COUNT(u.id)::int AS usage_count FROM coupons c LEFT JOIN coupon_usages u ON u.coupon_id=c.id GROUP BY c.id ORDER BY c.created_at DESC')).rows; }
  async createCoupon(input) { const r=await this.query(`INSERT INTO coupons(code,description,discount_type,discount_value,min_order_inr,max_discount_inr,total_usage_limit,per_customer_limit,starts_at,expires_at,first_order_only,applicability,applicable_product_ids,applicable_categories,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid[],$14,$15) RETURNING *`,[String(input.code).trim().toUpperCase(),input.description||null,input.discount_type,input.discount_value,input.min_order_inr||0,input.max_discount_inr??null,input.total_usage_limit??null,input.per_customer_limit||1,input.starts_at||null,input.expires_at||null,Boolean(input.first_order_only),input.applicability||'all',input.applicable_product_ids||[],input.applicable_categories||[],input.active!==false]); return r.rows[0]; }
  async updateCoupon(id,input) { const cols={code:'code',description:'description',discount_type:'discount_type',discount_value:'discount_value',min_order_inr:'min_order_inr',max_discount_inr:'max_discount_inr',total_usage_limit:'total_usage_limit',per_customer_limit:'per_customer_limit',starts_at:'starts_at',expires_at:'expires_at',first_order_only:'first_order_only',applicability:'applicability',applicable_product_ids:'applicable_product_ids',applicable_categories:'applicable_categories',active:'active'}; const keys=Object.keys(cols).filter(k=>input[k]!==undefined); if(!keys.length) return (await this.query('SELECT * FROM coupons WHERE id=$1',[id])).rows[0]||null; const set=keys.map((k,i)=>`${cols[k]}=$${i+1}${k==='applicable_product_ids'?'::uuid[]':''}`).join(','); const vals=keys.map(k=>k==='code'?String(input[k]).trim().toUpperCase():input[k]); const r=await this.query(`UPDATE coupons SET ${set},updated_at=NOW() WHERE id=$${keys.length+1} RETURNING *`,[...vals,id]); return r.rows[0]||null; }
  async deleteCoupon(id) { return (await this.query('DELETE FROM coupons WHERE id=$1',[id])).rowCount>0; }
  async couponUsage(id) { return (await this.query('SELECT order_id,customer_id,coupon_code,discount_inr,created_at FROM coupon_usages WHERE coupon_id=$1 ORDER BY created_at DESC',[id])).rows; }
  async validateCoupon(code,requestedItems,customerId,email) { const c=await this.pool.connect(); try { await c.query('BEGIN'); const coupon=(await c.query('SELECT * FROM coupons WHERE code=$1',[String(code).trim().toUpperCase()])).rows[0]; if(!coupon) throw new Error('Coupon code is invalid'); const products=await lockProductsForItems(c,requestedItems||[]); const items=buildOrderItems(products,requestedItems||[]); const subtotal=items.reduce((s,i)=>s+i.unitPriceInr*i.quantity,0); const eligibleSubtotal=await checkCouponEligibility(c,coupon,items,subtotal,customerId,email); await c.query('ROLLBACK'); return {coupon,subtotal,discount_inr:calculateCouponDiscount(coupon,eligibleSubtotal),shipping_inr:0}; } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
  async listGalleryImages({ publishedOnly = false } = {}) { const result = await this.query(`SELECT * FROM gallery_images ${publishedOnly ? 'WHERE published = TRUE' : ''} ORDER BY order_index, created_at, id`); return result.rows; }
  async createGalleryImage(input) { const imageUrl = input.image_url ?? input.media_url ?? null; const mediaUrl = input.media_url ?? imageUrl; const result = await this.query('INSERT INTO gallery_images (image_url, media_type, media_url, thumbnail_url, thumbnail_storage_public_id, external_url, storage_public_id, title, description, category, published, order_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [imageUrl, input.media_type || 'photo', mediaUrl, input.thumbnail_url || null, input.thumbnail_storage_public_id || null, input.external_url || null, input.storage_public_id || null, input.title, input.description || '', input.category || 'General', input.published === true, Number(input.order_index) || 0]); return result.rows[0]; }
  async updateGalleryImage(id, input) { const fields = ['title', 'description', 'category', 'published', 'order_index', 'external_url', 'thumbnail_url'].filter((field) => input[field] !== undefined); if (!fields.length) return this.getGalleryImage(id); const sets = fields.map((field, index) => `${field}=$${index + 1}`).join(', '); const result = await this.query(`UPDATE gallery_images SET ${sets}, updated_at=NOW() WHERE id=$${fields.length + 1} RETURNING *`, [...fields.map((field) => input[field]), id]); return result.rows[0] || null; }
  async getGalleryImage(id) { const result = await this.query('SELECT * FROM gallery_images WHERE id=$1', [id]); return result.rows[0] || null; }
  async deleteGalleryImage(id) { const result = await this.query('DELETE FROM gallery_images WHERE id=$1', [id]); return result.rowCount > 0; }
  async listShopBanners({ activeOnly = false } = {}) { const result = await this.query(`SELECT * FROM shop_banners ${activeOnly ? 'WHERE active = TRUE' : ''} ORDER BY order_index, created_at, id`); return result.rows; }
  async createShopBanner(input) { const result = await this.query('INSERT INTO shop_banners (title, link_url, media_url, media_type, storage_public_id, active, order_index) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [input.title || '', input.link_url || null, input.media_url, input.media_type, input.storage_public_id || null, input.active !== false, Number(input.order_index) || 0]); return result.rows[0]; }
  async getShopBannerByCreationKey(key) { if (!key) return null; const result = await this.query('SELECT * FROM shop_banners WHERE creation_idempotency_key=$1', [key]); return result.rows[0] || null; }
  async createShopBannerIdempotently(input, key) { const inserted = await this.query('INSERT INTO shop_banners (title, link_url, media_url, media_type, storage_public_id, active, order_index, creation_idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (creation_idempotency_key) DO NOTHING RETURNING *', [input.title || '', input.link_url || null, input.media_url, input.media_type, input.storage_public_id || null, input.active !== false, Number(input.order_index) || 0, key]); if (inserted.rows[0]) return { banner: inserted.rows[0], duplicate: false }; const existing = await this.getShopBannerByCreationKey(key); if (!existing) throw new Error('Banner creation could not be confirmed. Retry with the same request key.'); return { banner: existing, duplicate: true }; }
  async updateShopBanner(id, input) { const fields = ['title', 'link_url', 'media_url', 'media_type', 'storage_public_id', 'active', 'order_index'].filter((field) => input[field] !== undefined); if (!fields.length) { const result = await this.query('SELECT * FROM shop_banners WHERE id=$1', [id]); return result.rows[0] || null; } const sets = fields.map((field, index) => `${field}=$${index + 1}`).join(', '); const result = await this.query(`UPDATE shop_banners SET ${sets}, updated_at=NOW() WHERE id=$${fields.length + 1} RETURNING *`, [...fields.map((field) => input[field]), id]); return result.rows[0] || null; }
  async deleteShopBanner(id) { const result = await this.query('DELETE FROM shop_banners WHERE id=$1', [id]); return result.rowCount > 0; }
  async listProducts({ admin = false, q = '', category = '', requestId = null } = {}) {
    const conditions = [];
    const columns = admin ? '*' : 'id, sku, name, category, description, price_inr, discount_percent, variants, specifications, stock, unit, dimensions, weight, material, finish, availability, image_path, image_paths, verification_status, active, created_at, updated_at';
    if (!admin) conditions.push("active = TRUE AND verification_status = 'verified'");
    const values = [];
    const needle = q.trim();
    if (needle) {
      values.push(`%${needle}%`);
      const parameter = `$${values.length}`;
      conditions.push(`(name ILIKE ${parameter} OR category ILIKE ${parameter} OR COALESCE(sku, '') ILIKE ${parameter})`);
    }
    if (category) {
      values.push(category);
      conditions.push(`category = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const startedAt = process.hrtime.bigint();
    let client;
    try {
      const acquireStartedAt = process.hrtime.bigint();
      client = await this.pool.connect();
      const poolAcquireMs = Number(process.hrtime.bigint() - acquireStartedAt) / 1e6;
      const queryStartedAt = process.hrtime.bigint();
      const result = await client.query(`SELECT ${columns} FROM products ${where} ORDER BY name`, values);
      const queryDurationMs = Number(process.hrtime.bigint() - queryStartedAt) / 1e6;
      if (!admin) console.info('[database] Public catalogue query', { requestId, poolAcquireMs, queryDurationMs, durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6, count: result.rowCount });
      return result.rows;
    } catch (error) {
      if (!admin) console.warn('[database] Public catalogue query failed', { requestId, durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6, code: error.code || 'database_error', name: error.name || 'Error' });
      throw error;
    } finally {
      client?.release();
    }
  }
  async getProduct(id) { const r = await this.query('SELECT * FROM products WHERE id = $1', [id]); return r.rows[0] || null; }
  async getProductByCreationKey(key) { if (!key) return null; const r = await this.query('SELECT * FROM products WHERE creation_idempotency_key = $1', [key]); return r.rows[0] || null; }
  async createProduct(p) { const r = await this.query(`INSERT INTO products (${productFields.join(',')}) VALUES (${productFields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, productFields.map((field) => ['variants', 'image_paths', 'image_public_ids'].includes(field) ? JSON.stringify(p[field] || []) : field === 'specifications' ? JSON.stringify(p[field] || {}) : p[field] ?? null)); return r.rows[0]; }
  async createProductIdempotently(input, key) {
    const product = { ...input, creation_idempotency_key: key };
    const inserted = await this.query(`INSERT INTO products (${productFields.join(',')}) VALUES (${productFields.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT (creation_idempotency_key) DO NOTHING RETURNING *`, productFields.map((field) => ['variants', 'image_paths', 'image_public_ids'].includes(field) ? JSON.stringify(product[field] || []) : field === 'specifications' ? JSON.stringify(product[field] || {}) : product[field] ?? null));
    if (inserted.rows[0]) return { product: inserted.rows[0], duplicate: false };
    const existing = await this.getProductByCreationKey(key);
    if (!existing) throw new Error('Product creation could not be confirmed. Retry with the same request key.');
    return { product: existing, duplicate: true };
  }
  async updateProduct(id, p) { const safeKeys = Object.keys(p).filter((key) => productFields.includes(key)); if (!safeKeys.length) return this.getProduct(id); const sets = safeKeys.map((key, i) => `${key} = $${i + 1}`).join(', '); const values = safeKeys.map((key) => ['variants', 'image_paths', 'image_public_ids'].includes(key) ? JSON.stringify(p[key] || []) : key === 'specifications' ? JSON.stringify(p[key] || {}) : p[key]); const r = await this.query(`UPDATE products SET ${sets}, updated_at = NOW() WHERE id = $${safeKeys.length + 1} RETURNING *`, [...values, id]); return r.rows[0] || null; }
  async deleteProduct(id) { const r = await this.query('DELETE FROM products WHERE id = $1', [id]); return r.rowCount > 0; }
  async isCloudinaryAssetReferenced(publicId, url, exclude = {}) { const result = await this.query(`SELECT EXISTS (SELECT 1 FROM products WHERE id::text <> $1 AND (($2 <> '' AND (image_path=$2 OR image_paths @> to_jsonb($2::text) OR image_public_ids @> to_jsonb($3::text))) OR ($3 <> '' AND image_public_ids @> to_jsonb($3::text)))) OR EXISTS (SELECT 1 FROM shop_banners WHERE id::text <> $1 AND (($2 <> '' AND media_url=$2) OR ($3 <> '' AND storage_public_id=$3))) OR EXISTS (SELECT 1 FROM gallery_images WHERE id::text <> $1 AND (($2 <> '' AND (media_url=$2 OR image_url=$2 OR thumbnail_url=$2)) OR ($3 <> '' AND (storage_public_id=$3 OR thumbnail_storage_public_id=$3)))) AS referenced`, [String(exclude.id || ''), String(url || ''), String(publicId || '')]); return result.rows[0]?.referenced === true; }
  async findAdmin(email) { const r = await this.query('SELECT * FROM admin_users WHERE email = $1', [email.toLowerCase()]); return r.rows[0] || null; }
  async findAdminById(id) { const r = await this.query('SELECT * FROM admin_users WHERE id = $1', [id]); return r.rows[0] || null; }
  async updateAdminPassword(id, passwordHash) { const r = await this.query('UPDATE admin_users SET password_hash = $1, session_version = session_version + 1 WHERE id = $2 RETURNING *', [passwordHash, id]); return r.rows[0] || null; }
  async findOrderByIdempotencyKey(key) { if (!key) return null; const r = await this.query('SELECT * FROM orders WHERE idempotency_key = $1', [key]); return r.rows[0] || null; }
  async createOrder(order) { const client = await this.pool.connect(); try { await client.query('BEGIN'); const r = await client.query('INSERT INTO orders (customer_id, customer, items, subtotal_inr, shipping_inr, total_inr, payment_method, payment_status, payment_reference, idempotency_key, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [order.customer_id || null, order.customer, JSON.stringify(order.items), order.subtotal_inr, order.shipping_inr || 0, order.total_inr, order.payment_method, order.payment_status, order.payment_reference, order.idempotency_key, order.status]); await client.query('COMMIT'); return r.rows[0]; } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
  async createOrderIdempotently(order) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query('INSERT INTO orders (customer_id, customer, items, subtotal_inr, shipping_inr, total_inr, payment_method, payment_status, payment_reference, idempotency_key, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *', [order.customer_id || null, order.customer, JSON.stringify(order.items), order.subtotal_inr, order.shipping_inr || 0, order.total_inr, order.payment_method, order.payment_status, order.payment_reference, order.idempotency_key, order.status]);
      if (inserted.rows[0]) {
        await client.query('COMMIT');
        return { order: inserted.rows[0], duplicate: false };
      }
      const existing = await client.query('SELECT * FROM orders WHERE idempotency_key = $1', [order.idempotency_key]);
      if (!existing.rows[0]) throw new Error('The order could not be saved. Please try again.');
      await client.query('COMMIT');
      return { order: existing.rows[0], duplicate: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async createOrderWithInventory(order) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const products = await lockProductsForItems(client, order.requestedItems || []);
      if (order.idempotency_key) {
        const existing = await client.query('SELECT * FROM orders WHERE idempotency_key=$1', [order.idempotency_key]);
        if (existing.rows[0]) { await client.query('COMMIT'); return { order: existing.rows[0], duplicate: true }; }
      }
      const items = buildOrderItems(products, order.requestedItems);
      const subtotal = items.reduce((sum, item) => sum + item.unitPriceInr * item.quantity, 0);
      let coupon=null; let discount=0;
      if(order.coupon_code) { coupon=(await client.query('SELECT * FROM coupons WHERE code=$1 FOR UPDATE',[String(order.coupon_code).trim().toUpperCase()])).rows[0]; if(!coupon) throw new Error('Coupon code is invalid'); const eligibleSubtotal=await checkCouponEligibility(client,coupon,items,subtotal,order.customer_id,order.customer?.email); discount=calculateCouponDiscount(coupon,eligibleSubtotal); }
      const total=Math.max(0,subtotal-discount+Number(order.shipping_inr||0));
      const values = [order.customer_id || null, order.customer, JSON.stringify(items), subtotal, order.shipping_inr || 0, total, order.payment_method, order.payment_status, order.payment_reference, order.idempotency_key, order.status,coupon?.id||null,coupon?.code||null,discount];
      const inserted = await client.query('INSERT INTO orders (customer_id,customer,items,subtotal_inr,shipping_inr,total_inr,payment_method,payment_status,payment_reference,idempotency_key,status,coupon_id,coupon_code,discount_inr) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *', values);
      if (!inserted.rows[0]) {
        const existing = await client.query('SELECT * FROM orders WHERE idempotency_key=$1', [order.idempotency_key]);
        if (existing.rows[0]) { await client.query('ROLLBACK'); return { order: existing.rows[0], duplicate: true }; }
        throw new Error('The order could not be saved. Please retry with the same request key.');
      }
      if(coupon) await client.query('INSERT INTO coupon_usages(coupon_id,customer_id,customer_email,order_id,coupon_code,discount_inr) VALUES($1,$2,$3,$4,$5,$6)',[coupon.id,order.customer_id||null,String(order.customer?.email||'').toLowerCase()||null,inserted.rows[0].id,coupon.code,discount]);
      await changeLockedInventory(client, products, items, -1);
      await client.query('COMMIT');
      return { order: inserted.rows[0], duplicate: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async listOrders() { return (await this.query('SELECT * FROM orders ORDER BY created_at DESC')).rows; }
  async findCustomer(email) { const r = await this.query('SELECT * FROM customers WHERE email = $1', [email.toLowerCase()]); return r.rows[0] || null; }
  async findCustomerByGoogleId(googleId) { const r = await this.query('SELECT * FROM customers WHERE google_id = $1', [googleId]); return r.rows[0] || null; }
  async createCustomer(input) { const r = await this.query('INSERT INTO customers (email,password_hash,name,google_id,avatar_url) VALUES ($1,$2,$3,$4,$5) RETURNING *', [input.email.toLowerCase(), input.password_hash || null, input.name, input.google_id || null, input.avatar_url || null]); return r.rows[0]; }
  async getCustomer(id) { const r = await this.query('SELECT * FROM customers WHERE id = $1', [id]); return r.rows[0] || null; }
  async saveCustomerPasswordReset(email, tokenHash, expiresAt) { const result = await this.query('UPDATE customers SET password_reset_token_hash=$1,password_reset_expires_at=$2 WHERE email=$3 RETURNING *', [tokenHash, expiresAt, email.toLowerCase()]); return result.rows[0] || null; }
  async clearCustomerPasswordReset(tokenHash) { await this.query('UPDATE customers SET password_reset_token_hash=NULL,password_reset_expires_at=NULL WHERE password_reset_token_hash=$1', [tokenHash]); }
  async resetCustomerPassword(tokenHash, passwordHash) { const result = await this.query('UPDATE customers SET password_hash=$1,password_reset_token_hash=NULL,password_reset_expires_at=NULL,session_version=session_version+1,updated_at=NOW() WHERE password_reset_token_hash=$2 AND password_reset_expires_at>NOW() RETURNING *', [passwordHash, tokenHash]); return result.rows[0] || null; }
  async updateCustomer(id, input) { const keys = Object.keys(input).filter((key) => ['name', 'phone', 'address', 'city', 'state', 'pin'].includes(key)); if (!keys.length) return this.getCustomer(id); const sets = keys.map((key, i) => `${key}=$${i + 1}`).join(', '); const r = await this.query(`UPDATE customers SET ${sets},updated_at=NOW() WHERE id=$${keys.length + 1} RETURNING *`, [...keys.map((key) => input[key]), id]); return r.rows[0] || null; }
  async listCustomerOrders(customerId) { return (await this.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [customerId])).rows; }
  async requestCancellation(id, customerId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT * FROM orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [id, customerId]);
      const order = found.rows[0];
      if (!order) { await client.query('ROLLBACK'); return { kind: 'missing' }; }
      if (['delivered','completed','cancelled'].includes(order.status)) { await client.query('ROLLBACK'); return { kind: 'ineligible' }; }
      if (order.cancellation_request_status === 'pending') { await client.query('ROLLBACK'); return { kind: 'duplicate' }; }
      const shipped = order.status === 'shipped';
      if (!shipped) await restorePostgresOrderInventory(client, order);
      const result = await client.query('UPDATE orders SET status=$1,cancellation_request_status=$2,cancellation_requested_at=NOW(),updated_at=NOW() WHERE id=$3 RETURNING *', [shipped ? 'shipped' : 'cancelled', shipped ? 'pending' : 'approved', id]);
      await client.query('COMMIT');
      return { kind: 'ok', order: result.rows[0] };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async decideCancellation(id, decision) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query("SELECT * FROM orders WHERE id=$1 AND cancellation_request_status='pending' FOR UPDATE", [id]);
      const order = found.rows[0];
      if (!order) { await client.query('ROLLBACK'); return null; }
      if (decision === 'approved') await restorePostgresOrderInventory(client, order);
      const status = decision === 'approved' ? 'cancelled' : 'shipped';
      const saved = await client.query('UPDATE orders SET cancellation_request_status=$1,cancellation_decided_at=NOW(),status=$2,updated_at=NOW() WHERE id=$3 RETURNING *', [decision, status, id]);
      await client.query('COMMIT');
      return saved.rows[0] || null;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async listAddresses(customerId) { return (await this.query('SELECT * FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC', [customerId])).rows; }
  async createAddress(customerId, input) { const client = await this.pool.connect(); try { await client.query('BEGIN'); if (input.is_default) await client.query('UPDATE customer_addresses SET is_default=FALSE WHERE customer_id=$1', [customerId]); const r = await client.query('INSERT INTO customer_addresses (customer_id,label,recipient_name,phone,address,city,state,pin,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [customerId, input.label, input.recipient_name, input.phone, input.address, input.city, input.state, input.pin, input.is_default]); await client.query('COMMIT'); return r.rows[0]; } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
  async updateAddress(id, customerId, input) { const client = await this.pool.connect(); try { await client.query('BEGIN'); if (input.is_default) await client.query('UPDATE customer_addresses SET is_default=FALSE WHERE customer_id=$1', [customerId]); const keys = Object.keys(input).filter((key) => ['label', 'recipient_name', 'phone', 'address', 'city', 'state', 'pin', 'is_default'].includes(key)); const sets = keys.map((key, i) => `${key}=$${i + 1}`).join(', '); const r = await client.query(`UPDATE customer_addresses SET ${sets},updated_at=NOW() WHERE id=$${keys.length + 1} AND customer_id=$${keys.length + 2} RETURNING *`, [...keys.map((key) => input[key]), id, customerId]); await client.query('COMMIT'); return r.rows[0] || null; } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
  async deleteAddress(id, customerId) { const r = await this.query('DELETE FROM customer_addresses WHERE id=$1 AND customer_id=$2', [id, customerId]); return r.rowCount > 0; }
  async updateOrderStatus(id, status) {
    const allowed = { enquiry:['pending','confirmed','cancelled'], pending:['confirmed','processing','cancelled'], confirmed:['processing','shipped','cancelled'], processing:['shipped','cancelled'], packed:['shipped','cancelled'], shipped:['delivered'], delivered:['completed'], completed:[], cancelled:[] };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
      const order = found.rows[0];
      if (!order) { await client.query('ROLLBACK'); return null; }
      if (order.status !== status && !allowed[order.status]?.includes(status)) { await client.query('ROLLBACK'); return { invalidTransition: true }; }
      if (order.status !== 'cancelled' && status === 'cancelled') await restorePostgresOrderInventory(client, order);
      const saved = await client.query('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [status,id]);
      await client.query('COMMIT');
      return saved.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async markCodCollected(id, adminEmail) { const r = await this.query("UPDATE orders SET payment_status='verified',payment_verified_at=NOW(),payment_verified_by=$1,payment_evidence_note='Cash collected on delivery',updated_at=NOW() WHERE id=$2 AND UPPER(payment_method)='COD' AND payment_status='pending' RETURNING *", [adminEmail,id]); return r.rows[0] || null; }
  async verifyPayment(id, verification) { const r = await this.query('UPDATE orders SET payment_status=$1,payment_verified_at=$2,payment_verified_by=$3,payment_evidence_note=$4,updated_at=NOW() WHERE id=$5 RETURNING *', [verification.payment_status, verification.payment_verified_at, verification.payment_verified_by, verification.payment_evidence_note, id]); return r.rows[0] || null; }
  async dashboard() { const products = await this.query(`SELECT COUNT(*)::int AS "totalProducts", COUNT(*) FILTER (WHERE active AND verification_status='verified')::int AS "publishedProducts", COUNT(*) FILTER (WHERE verification_status='pending')::int AS "pendingProducts", COUNT(*) FILTER (WHERE NOT active OR verification_status='rejected')::int AS "draftProducts" FROM products`); const orders = await this.query(`SELECT COUNT(*)::int AS "totalOrders" FROM orders`); const recent = await this.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5'); return { ...products.rows[0], ...orders.rows[0], recentOrders: recent.rows }; }
  async close() { await this.pool.end(); }
}

export function createRepository() {
  const useMemory = process.env.USE_IN_MEMORY_DB === 'true';
  const hasDatabase = Boolean(process.env.DATABASE_URL);
  if (useMemory) return new MemoryRepository();
  if (!hasDatabase) throw new Error('DATABASE_URL is required when USE_IN_MEMORY_DB is false.');
  return new PostgresRepository();
}
