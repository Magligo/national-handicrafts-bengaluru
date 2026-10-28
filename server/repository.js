import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const productFields = ['sku', 'name', 'category', 'description', 'price_inr', 'discount_percent', 'variants', 'stock', 'unit', 'dimensions', 'weight', 'material', 'finish', 'availability', 'image_path', 'image_paths', 'source_catalogue', 'source_page', 'verification_status', 'active'];

export class MemoryRepository {
  constructor(seed = {}) { this.products = [...(seed.products || [])]; this.orders = [...(seed.orders || [])]; this.adminUsers = [...(seed.adminUsers || [])]; this.customers = [...(seed.customers || [])]; this.addresses = [...(seed.addresses || [])]; }
  async listProducts({ admin = false, q = '', category = '' } = {}) { const needle = q.trim().toLowerCase(); return this.products.filter((p) => (admin || (p.active && p.verification_status === 'verified')) && (!category || p.category === category) && (!needle || `${p.name} ${p.category} ${p.sku || ''}`.toLowerCase().includes(needle))).sort((a, b) => a.name.localeCompare(b.name)); }
  async getProduct(id) { return this.products.find((p) => p.id === id) || null; }
  async createProduct(input) { const p = { id: randomUUID(), image_paths: [], ...input, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.products.push(p); return p; }
  async updateProduct(id, input) { const p = await this.getProduct(id); if (!p) return null; Object.assign(p, input, { updated_at: new Date().toISOString() }); return p; }
  async deleteProduct(id) { const before = this.products.length; this.products = this.products.filter((p) => p.id !== id); return this.products.length < before; }
  async findAdmin(email) { return this.adminUsers.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null; }
  async findAdminById(id) { return this.adminUsers.find((u) => u.id === id) || null; }
  async updateAdminPassword(id, passwordHash) { const user = await this.findAdminById(id); if (!user) return null; user.password_hash = passwordHash; user.session_version = Number(user.session_version || 0) + 1; return user; }
  async findOrderByIdempotencyKey(key) { return key ? this.orders.find((order) => order.idempotency_key === key) || null : null; }
  async createOrder(order) { const saved = { id: `NH-${Date.now()}-${randomUUID().slice(0, 6)}`, shipping_inr: 0, ...order, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.orders.unshift(saved); return saved; }
  async findCustomer(email) { return this.customers.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null; }
  async findCustomerByGoogleId(googleId) { return this.customers.find((u) => u.google_id === googleId) || null; }
  async createCustomer(input) { const customer = { id: randomUUID(), ...input, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.customers.push(customer); return customer; }
  async getCustomer(id) { return this.customers.find((customer) => customer.id === id) || null; }
  async updateCustomer(id, input) { const customer = await this.getCustomer(id); if (!customer) return null; Object.assign(customer, input, { updated_at: new Date().toISOString() }); return customer; }
  async listCustomerOrders(customerId) { return this.orders.filter((order) => order.customer_id === customerId); }
  async listAddresses(customerId) { return this.addresses.filter((address) => address.customer_id === customerId).sort((a, b) => Number(b.is_default) - Number(a.is_default)); }
  async createAddress(customerId, input) { if (input.is_default) this.addresses.filter((address) => address.customer_id === customerId).forEach((address) => { address.is_default = false; }); const address = { id: randomUUID(), customer_id: customerId, ...input, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; this.addresses.push(address); return address; }
  async updateAddress(id, customerId, input) { const address = this.addresses.find((item) => item.id === id && item.customer_id === customerId); if (!address) return null; if (input.is_default) this.addresses.filter((item) => item.customer_id === customerId).forEach((item) => { item.is_default = false; }); Object.assign(address, input, { updated_at: new Date().toISOString() }); return address; }
  async deleteAddress(id, customerId) { const before = this.addresses.length; this.addresses = this.addresses.filter((item) => !(item.id === id && item.customer_id === customerId)); return this.addresses.length < before; }
  async listOrders() { return this.orders; }
  async updateOrderStatus(id, status) { const order = this.orders.find((o) => o.id === id); if (!order) return null; order.status = status; order.updated_at = new Date().toISOString(); return order; }
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
      connectionTimeoutMillis: 10000,
    });
  }
  async query(text, values) { return this.pool.query(text, values); }
  async listProducts({ admin = false, q = '', category = '' } = {}) { const visibility = admin ? '' : 'AND active = TRUE AND verification_status = \'verified\''; const r = await this.query(`SELECT * FROM products WHERE 1=1 ${visibility} AND ($1 = '' OR name ILIKE $2 OR category ILIKE $2 OR COALESCE(sku, '') ILIKE $2) AND ($3 = '' OR category = $3) ORDER BY name`, [q.trim(), `%${q.trim()}%`, category]); return r.rows; }
  async getProduct(id) { const r = await this.query('SELECT * FROM products WHERE id = $1', [id]); return r.rows[0] || null; }
  async createProduct(p) { const r = await this.query(`INSERT INTO products (${productFields.join(',')}) VALUES (${productFields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, productFields.map((field) => field === 'variants' || field === 'image_paths' ? JSON.stringify(p[field] || []) : p[field] ?? null)); return r.rows[0]; }
  async updateProduct(id, p) { const safeKeys = Object.keys(p).filter((key) => productFields.includes(key)); if (!safeKeys.length) return this.getProduct(id); const sets = safeKeys.map((key, i) => `${key} = $${i + 1}`).join(', '); const values = safeKeys.map((key) => ['variants', 'image_paths'].includes(key) ? JSON.stringify(p[key] || []) : p[key]); const r = await this.query(`UPDATE products SET ${sets}, updated_at = NOW() WHERE id = $${safeKeys.length + 1} RETURNING *`, [...values, id]); return r.rows[0] || null; }
  async deleteProduct(id) { const r = await this.query('DELETE FROM products WHERE id = $1', [id]); return r.rowCount > 0; }
  async findAdmin(email) { const r = await this.query('SELECT * FROM admin_users WHERE email = $1', [email.toLowerCase()]); return r.rows[0] || null; }
  async findAdminById(id) { const r = await this.query('SELECT * FROM admin_users WHERE id = $1', [id]); return r.rows[0] || null; }
  async updateAdminPassword(id, passwordHash) { const r = await this.query('UPDATE admin_users SET password_hash = $1, session_version = session_version + 1 WHERE id = $2 RETURNING *', [passwordHash, id]); return r.rows[0] || null; }
  async findOrderByIdempotencyKey(key) { if (!key) return null; const r = await this.query('SELECT * FROM orders WHERE idempotency_key = $1', [key]); return r.rows[0] || null; }
  async createOrder(order) { const client = await this.pool.connect(); try { await client.query('BEGIN'); const r = await client.query('INSERT INTO orders (customer_id, customer, items, subtotal_inr, shipping_inr, total_inr, payment_method, payment_status, payment_reference, idempotency_key, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [order.customer_id || null, order.customer, JSON.stringify(order.items), order.subtotal_inr, order.shipping_inr || 0, order.total_inr, order.payment_method, order.payment_status, order.payment_reference, order.idempotency_key, order.status]); await client.query('COMMIT'); return r.rows[0]; } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
  async listOrders() { return (await this.query('SELECT * FROM orders ORDER BY created_at DESC')).rows; }
  async findCustomer(email) { const r = await this.query('SELECT * FROM customers WHERE email = $1', [email.toLowerCase()]); return r.rows[0] || null; }
  async findCustomerByGoogleId(googleId) { const r = await this.query('SELECT * FROM customers WHERE google_id = $1', [googleId]); return r.rows[0] || null; }
  async createCustomer(input) { const r = await this.query('INSERT INTO customers (email,password_hash,name,google_id,avatar_url) VALUES ($1,$2,$3,$4,$5) RETURNING *', [input.email.toLowerCase(), input.password_hash || null, input.name, input.google_id || null, input.avatar_url || null]); return r.rows[0]; }
  async getCustomer(id) { const r = await this.query('SELECT * FROM customers WHERE id = $1', [id]); return r.rows[0] || null; }
  async updateCustomer(id, input) { const keys = Object.keys(input).filter((key) => ['name', 'phone', 'address', 'city', 'state', 'pin'].includes(key)); if (!keys.length) return this.getCustomer(id); const sets = keys.map((key, i) => `${key}=$${i + 1}`).join(', '); const r = await this.query(`UPDATE customers SET ${sets},updated_at=NOW() WHERE id=$${keys.length + 1} RETURNING *`, [...keys.map((key) => input[key]), id]); return r.rows[0] || null; }
  async listCustomerOrders(customerId) { return (await this.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [customerId])).rows; }
  async listAddresses(customerId) { return (await this.query('SELECT * FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at DESC', [customerId])).rows; }
  async createAddress(customerId, input) { const client = await this.pool.connect(); try { await client.query('BEGIN'); if (input.is_default) await client.query('UPDATE customer_addresses SET is_default=FALSE WHERE customer_id=$1', [customerId]); const r = await client.query('INSERT INTO customer_addresses (customer_id,label,recipient_name,phone,address,city,state,pin,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [customerId, input.label, input.recipient_name, input.phone, input.address, input.city, input.state, input.pin, input.is_default]); await client.query('COMMIT'); return r.rows[0]; } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
  async updateAddress(id, customerId, input) { const client = await this.pool.connect(); try { await client.query('BEGIN'); if (input.is_default) await client.query('UPDATE customer_addresses SET is_default=FALSE WHERE customer_id=$1', [customerId]); const keys = Object.keys(input).filter((key) => ['label', 'recipient_name', 'phone', 'address', 'city', 'state', 'pin', 'is_default'].includes(key)); const sets = keys.map((key, i) => `${key}=$${i + 1}`).join(', '); const r = await client.query(`UPDATE customer_addresses SET ${sets},updated_at=NOW() WHERE id=$${keys.length + 1} AND customer_id=$${keys.length + 2} RETURNING *`, [...keys.map((key) => input[key]), id, customerId]); await client.query('COMMIT'); return r.rows[0] || null; } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } }
  async deleteAddress(id, customerId) { const r = await this.query('DELETE FROM customer_addresses WHERE id=$1 AND customer_id=$2', [id, customerId]); return r.rowCount > 0; }
  async updateOrderStatus(id, status) { const r = await this.query('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [status,id]); return r.rows[0] || null; }
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
