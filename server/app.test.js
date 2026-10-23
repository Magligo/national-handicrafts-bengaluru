import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from './app.js';
import { MemoryRepository } from './repository.js';

async function setup(role = 'admin') {
  const repo = new MemoryRepository({ adminUsers: [{ id: 'a1', email: 'admin@test.local', password_hash: await bcrypt.hash('correct horse battery staple', 10), role }] });
  const { app } = createApp({ repo, secret: 'test-secret' });
  return { app, repo };
}

async function signIn(app) {
  const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'correct horse battery staple' });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'];
  const csrf = await request(app).get('/api/auth/csrf').set('Cookie', cookie);
  assert.equal(csrf.status, 200);
  return { cookie, token: csrf.body.data.token };
}

function adminRequest(app, auth, method, path) { return request(app)[method](path).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.token); }
async function customerSignIn(app, email = 'asha@example.com', password = 'customer-password') { const login = await request(app).post('/api/customer/auth/login').send({ email, password }); assert.equal(login.status, 200); const cookie = login.headers['set-cookie']; const csrf = await request(app).get('/api/customer/auth/csrf').set('Cookie', cookie); assert.equal(csrf.status, 200); return { cookie, token: csrf.body.data.token }; }
function customerRequest(app, auth, method, path) { return request(app)[method](path).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.token); }

test('rejects admin API access without a session', async () => {
  const { app } = await setup();
  const response = await request(app).get('/api/admin/products');
  assert.equal(response.status, 401);
});

test('keeps customer and admin sessions isolated', async () => {
  const passwordHash = await bcrypt.hash('customer-password', 10);
  const repo = new MemoryRepository({
    adminUsers: [{ id: 'a1', email: 'admin@test.local', password_hash: await bcrypt.hash('correct horse battery staple', 10), role: 'admin' }],
    customers: [{ id: 'c1', email: 'asha@example.com', password_hash: passwordHash, name: 'Asha Rao' }],
  });
  const { app } = createApp({ repo, secret: 'test-secret' });
  const admin = await signIn(app);
  const customer = await customerSignIn(app);
  const adminWithCustomerSession = await request(app).get('/api/admin/products').set('Cookie', customer.cookie);
  const customerWithAdminSession = await request(app).get('/api/customer/orders').set('Cookie', admin.cookie);
  assert.equal(adminWithCustomerSession.status, 401);
  assert.equal(customerWithAdminSession.status, 401);
});

test('rejects non-admin roles at login', async () => {
  const { app } = await setup('editor');
  const response = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'correct horse battery staple' });
  assert.equal(response.status, 401);
});

test('admin login accepts the configured environment credentials', async () => {
  const previousEmail = process.env.ADMIN_EMAIL;
  const previousHash = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('environment-password', 10);
  try {
    const { app } = createApp({ repo: new MemoryRepository(), secret: 'test-secret' });
    const response = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'environment-password' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.email, 'admin@example.com');
    assert.ok(response.headers['set-cookie'].some((cookie) => cookie.startsWith('nh_admin_token=')));
  } finally {
    if (previousEmail === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = previousEmail;
    if (previousHash === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = previousHash;
  }
});

test('reports missing admin configuration instead of returning invalid credentials', async () => {
  const previousEmail = process.env.ADMIN_EMAIL;
  const previousHash = process.env.ADMIN_PASSWORD_HASH;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD_HASH;
  try {
    const { app } = await createApp({ repo: new MemoryRepository(), secret: 'test-secret' });
    const response = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'any-password' });
    assert.equal(response.status, 503);
    assert.match(response.body.error, /not configured/i);
  } finally {
    if (previousEmail === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = previousEmail;
    if (previousHash === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = previousHash;
  }
});

test('reports an invalid configured bcrypt hash', async () => {
  const previousEmail = process.env.ADMIN_EMAIL;
  const previousHash = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD_HASH = 'not-a-bcrypt-hash';
  try {
    const { app } = await createApp({ repo: new MemoryRepository(), secret: 'test-secret' });
    const response = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'any-password' });
    assert.equal(response.status, 503);
    assert.match(response.body.error, /valid bcrypt hash/i);
  } finally {
    if (previousEmail === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = previousEmail;
    if (previousHash === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = previousHash;
  }
});

test('rejects an incorrect password and incorrect email', async () => {
  const previousEmail = process.env.ADMIN_EMAIL;
  const previousHash = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('environment-password', 10);
  try {
    const { app } = createApp({ repo: new MemoryRepository(), secret: 'test-secret' });
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'wrong-password' });
    const wrongEmail = await request(app).post('/api/auth/login').send({ email: 'other@example.com', password: 'environment-password' });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongEmail.status, 401);
  } finally {
    if (previousEmail === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = previousEmail;
    if (previousHash === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = previousHash;
  }
});

test('rate limits failed admin logins without counting successful logins', async () => {
  const { app } = await setup();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failed = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'wrong-password' });
    assert.equal(failed.status, 401);
  }
  const blocked = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'wrong-password' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['retry-after'], '900');

  const { app: successfulApp } = await setup();
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const successful = await request(successfulApp).post('/api/auth/login').send({ email: 'admin@test.local', password: 'correct horse battery staple' });
    assert.equal(successful.status, 200);
  }
});

test('session persists through auth/me and logout clears it', async () => {
  const { app } = await setup();
  const auth = await signIn(app);
  const me = await request(app).get('/api/auth/me').set('Cookie', auth.cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.role, 'admin');
  const logout = await adminRequest(app, auth, 'post', '/api/auth/logout');
  assert.equal(logout.status, 204);
  const afterLogout = await request(app).get('/api/auth/me').set('Cookie', logout.headers['set-cookie'] || []);
  assert.equal(afterLogout.status, 401);
});

test('successful login can immediately load the authenticated dashboard data', async () => {
  const { app } = await setup();
  const auth = await signIn(app);
  const me = await request(app).get('/api/auth/me').set('Cookie', auth.cookie);
  const dashboard = await request(app).get('/api/admin/dashboard').set('Cookie', auth.cookie);
  const products = await request(app).get('/api/admin/products').set('Cookie', auth.cookie);
  const orders = await request(app).get('/api/admin/orders').set('Cookie', auth.cookie);
  const paymentSettings = await request(app).get('/api/admin/payment-settings').set('Cookie', auth.cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.role, 'admin');
  assert.equal(dashboard.status, 200);
  assert.equal(products.status, 200);
  assert.equal(orders.status, 200);
  assert.equal(paymentSettings.status, 200);
});

test('requires CSRF protection for admin mutations', async () => {
  const { app } = await setup();
  const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'correct horse battery staple' });
  const response = await request(app).post('/api/admin/products').set('Cookie', login.headers['set-cookie']).send({ name: 'Blocked Product', category: 'Brass', variants: [] });
  assert.equal(response.status, 403);
});

test('admin can add a verified product and it becomes public', async () => {
  const { app } = await setup();
  const auth = await signIn(app);
  const created = await adminRequest(app, auth, 'post', '/api/admin/products').send({ name: 'Test Bell', category: 'Brass', price: 850, stock: 3, variants: [], verificationStatus: 'verified', active: true, sourceCatalogue: 'Reviewed test record', sourcePage: 1 });
  assert.equal(created.status, 201);
  const products = await request(app).get('/api/products');
  assert.equal(products.body.data[0].name, 'Test Bell');
});

test('admin can upload multiple product images and select the main image', async () => {
  const { app } = await setup();
  const auth = await signIn(app);
  const response = await adminRequest(app, auth, 'post', '/api/admin/products').field('name', 'Image Test').field('category', 'Copper').field('variants', '[]').field('mainImageIndex', '1').attach('images', Buffer.from('first-image'), { filename: 'first.png', contentType: 'image/png' }).attach('images', Buffer.from('second-image'), { filename: 'second.png', contentType: 'image/png' });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.image_paths.length, 2);
  assert.equal(response.body.data.image_path, response.body.data.image_paths[1]);
  const deleted = await adminRequest(app, auth, 'delete', `/api/admin/products/${response.body.data.id}`);
  assert.equal(deleted.status, 204);
});

test('order total uses the server product price, not the client price', async () => {
  const { app, repo } = await setup();
  const auth = await signIn(app);
  await adminRequest(app, auth, 'post', '/api/admin/products').send({ name: 'Copper Bowl', category: 'Copper', price: 700, stock: 5, variants: [], verificationStatus: 'verified' });
  const product = (await request(app).get('/api/products')).body.data[0];
  const order = await request(app).post('/api/orders').set('Idempotency-Key', 'price-tamper-test').send({ customer: { name: 'Asha', email: 'asha@example.com', phone: '9876543210', address: '12 Market Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001' }, items: [{ id: product.id, quantity: 2, price: 1 }] });
  assert.equal(order.status, 201);
  assert.equal(order.body.data.total_inr, 1400);
  assert.equal(repo.orders[0].items[0].unitPriceInr, 700);
});

test('product details expose verified products and hide pending products', async () => {
  const { app } = await setup();
  const auth = await signIn(app);
  const pending = await adminRequest(app, auth, 'post', '/api/admin/products').send({ name: 'Pending Diya', category: 'Puja Articles', price: 500, stock: 2, variants: [], verificationStatus: 'pending' });
  const verified = await adminRequest(app, auth, 'post', '/api/admin/products').send({ name: 'Verified Diya', category: 'Puja Articles', price: 650, stock: 2, variants: [], verificationStatus: 'verified' });
  assert.equal((await request(app).get(`/api/products/${pending.body.data.id}`)).status, 404);
  const detail = await request(app).get(`/api/products/${verified.body.data.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.name, 'Verified Diya');
});

test('publishing and unpublishing controls public visibility', async () => {
  const { app } = await setup();
  const auth = await signIn(app);
  const created = await adminRequest(app, auth, 'post', '/api/admin/products').send({ name: 'Review Workflow Product', category: 'Brass', variants: [], verificationStatus: 'pending', active: false });
  assert.equal((await request(app).get('/api/products')).body.data.length, 0);
  const published = await adminRequest(app, auth, 'post', `/api/admin/products/${created.body.data.id}/publish`);
  assert.equal(published.status, 200);
  assert.equal((await request(app).get(`/api/products/${created.body.data.id}`)).status, 200);
  const unpublished = await adminRequest(app, auth, 'post', `/api/admin/products/${created.body.data.id}/unpublish`);
  assert.equal(unpublished.status, 200);
  assert.equal((await request(app).get(`/api/products/${created.body.data.id}`)).status, 404);
});

test('orders require a customer and at least one valid verified item', async () => {
  const { app } = await setup();
  const empty = await request(app).post('/api/orders').send({ customer: { name: 'Asha', email: 'asha@example.com' }, items: [] });
  assert.equal(empty.status, 400);
  const missingCustomer = await request(app).post('/api/orders').send({ items: [{ id: 'missing', quantity: 1 }] });
  assert.equal(missingCustomer.status, 400);
});

test('rejects invalid checkout details before creating an order', async () => {
  const { app } = await setup();
  const response = await request(app).post('/api/orders').send({ customer: { name: 'Asha', email: 'not-an-email' }, items: [{ id: 'missing', quantity: 1 }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /email/i);
});

test('creates one order for duplicate idempotency submissions and exposes it to admins', async () => {
  const { app, repo } = await setup();
  const auth = await signIn(app);
  const productResponse = await adminRequest(app, auth, 'post', '/api/admin/products').send({ name: 'Order Test Bowl', category: 'Brass', price: 900, stock: 4, variants: [], verificationStatus: 'verified' });
  const body = { customer: { name: 'Asha', email: 'asha@example.com', phone: '9876543210', address: '12 Market Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001', instructions: 'Call on arrival' }, items: [{ id: productResponse.body.data.id, quantity: 1 }] };
  const first = await request(app).post('/api/orders').set('Idempotency-Key', 'duplicate-order-test').send(body);
  const second = await request(app).post('/api/orders').set('Idempotency-Key', 'duplicate-order-test').send(body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(repo.orders.length, 1);
  const adminOrders = await adminRequest(app, auth, 'get', '/api/admin/orders');
  assert.equal(adminOrders.body.data[0].id, first.body.data.id);
  assert.equal(adminOrders.body.data[0].customer.address, '12 Market Road');
});

test('reports unavailable UPI configuration and requires evidence for manual verification', async () => {
  const previousId = process.env.PAYMENT_UPI_ID;
  const previousName = process.env.PAYMENT_UPI_PAYEE_NAME;
  delete process.env.PAYMENT_UPI_ID;
  delete process.env.PAYMENT_UPI_PAYEE_NAME;
  try {
    const { app } = await setup();
    const auth = await signIn(app);
    const config = await request(app).get('/api/payment/config');
    assert.deepEqual(config.body, { data: { enabled: false } });
    const product = await adminRequest(app, auth, 'post', '/api/admin/products').send({ name: 'Payment Test Plate', category: 'Copper', price: 500, stock: 2, variants: [], verificationStatus: 'verified' });
    const order = await request(app).post('/api/orders').send({ customer: { name: 'Asha', email: 'asha@example.com', phone: '9876543210', address: '12 Market Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001' }, items: [{ id: product.body.data.id, quantity: 1 }] });
    assert.equal(order.body.data.payment_status, 'not_configured');
    const blocked = await adminRequest(app, auth, 'post', `/api/admin/orders/${order.body.data.id}/payment/verify`).send({});
    assert.equal(blocked.status, 400);
    const verified = await adminRequest(app, auth, 'post', `/api/admin/orders/${order.body.data.id}/payment/verify`).send({ evidenceNote: 'Matched bank receipt reference NH-LOCAL-1' });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.data.payment_status, 'verified');
    assert.equal(verified.body.data.payment_verified_by, 'admin@test.local');
    assert.match(verified.body.data.payment_evidence_note, /Matched bank/);
  } finally {
    if (previousId === undefined) delete process.env.PAYMENT_UPI_ID; else process.env.PAYMENT_UPI_ID = previousId;
    if (previousName === undefined) delete process.env.PAYMENT_UPI_PAYEE_NAME; else process.env.PAYMENT_UPI_PAYEE_NAME = previousName;
  }
});

test('empty in-memory catalogue is a successful empty response', async () => {
  const { app } = createApp({ repo: new MemoryRepository(), secret: 'test-secret' });
  const health = await request(app).get('/api/health');
  const products = await request(app).get('/api/products');
  assert.deepEqual(health.body, { ok: true, service: 'national-handicrafts-api' });
  assert.equal(products.status, 200);
  assert.deepEqual(products.body, { data: [] });
});

test('customer registration and login create a separate authenticated session', async () => {
  const { app } = createApp({ repo: new MemoryRepository(), secret: 'test-secret' });
  const registered = await request(app).post('/api/customer/auth/register').send({ name: 'Asha Rao', email: 'asha@example.com', password: 'customer-password' });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.data.email, 'asha@example.com');
  assert.equal(registered.body.data.password_hash, undefined);
  assert.ok(registered.headers['set-cookie'].some((cookie) => cookie.startsWith('nh_customer_token=')));
  const duplicate = await request(app).post('/api/customer/auth/register').send({ name: 'Asha Rao', email: 'asha@example.com', password: 'customer-password' });
  assert.equal(duplicate.status, 409);
  const login = await request(app).post('/api/customer/auth/login').send({ email: 'asha@example.com', password: 'customer-password' });
  assert.equal(login.status, 200);
  const wrong = await request(app).post('/api/customer/auth/login').send({ email: 'asha@example.com', password: 'wrong-password' });
  assert.equal(wrong.status, 401);
});

test('customer profile and address mutations enforce ownership and CSRF', async () => {
  const passwordHash = await bcrypt.hash('customer-password', 10);
  const repo = new MemoryRepository({ customers: [{ id: 'c1', email: 'asha@example.com', password_hash: passwordHash, name: 'Asha Rao' }, { id: 'c2', email: 'bina@example.com', password_hash: passwordHash, name: 'Bina Das' }] });
  const { app } = createApp({ repo, secret: 'test-secret' });
  const asha = await customerSignIn(app);
  const csrfBlocked = await request(app).patch('/api/customer/profile').set('Cookie', asha.cookie).send({ name: 'Changed' });
  assert.equal(csrfBlocked.status, 403);
  const saved = await customerRequest(app, asha, 'patch', '/api/customer/profile').send({ name: 'Asha Rao', phone: '9876543210', address: '12 Market Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001' });
  assert.equal(saved.status, 200);
  const address = await customerRequest(app, asha, 'post', '/api/customer/addresses').send({ label: 'Home', recipientName: 'Asha Rao', phone: '9876543210', address: '12 Market Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001', isDefault: true });
  assert.equal(address.status, 201);
  const bina = await customerSignIn(app, 'bina@example.com');
  const blocked = await customerRequest(app, bina, 'patch', `/api/customer/addresses/${address.body.data.id}`).send({ label: 'Stolen', recipientName: 'Bina Das', phone: '9876543210', address: 'Other Road', city: 'Bengaluru', state: 'Karnataka', pin: '560002', isDefault: true });
  assert.equal(blocked.status, 404);
  const ashaAddresses = await request(app).get('/api/customer/addresses').set('Cookie', asha.cookie);
  assert.equal(ashaAddresses.body.data.length, 1);
});

test('customer orders are associated server-side and private to the signed-in customer', async () => {
  const passwordHash = await bcrypt.hash('customer-password', 10);
  const repo = new MemoryRepository({ customers: [{ id: 'c1', email: 'asha@example.com', password_hash: passwordHash, name: 'Asha Rao' }, { id: 'c2', email: 'bina@example.com', password_hash: passwordHash, name: 'Bina Das' }], products: [{ id: 'p1', name: 'Verified Bowl', category: 'Brass', price_inr: 900, stock: 3, active: true, verification_status: 'verified', image_path: null }] });
  const { app } = createApp({ repo, secret: 'test-secret' });
  const asha = await customerSignIn(app);
  const order = await customerRequest(app, asha, 'post', '/api/orders').send({ customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', address: '12 Market Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001' }, items: [{ id: 'p1', quantity: 1 }] });
  assert.equal(order.status, 201);
  assert.equal(order.body.data.customer_id, 'c1');
  const ownOrders = await request(app).get('/api/customer/orders').set('Cookie', asha.cookie);
  assert.equal(ownOrders.body.data.length, 1);
  const bina = await customerSignIn(app, 'bina@example.com');
  const otherOrders = await request(app).get('/api/customer/orders').set('Cookie', bina.cookie);
  assert.deepEqual(otherOrders.body.data, []);
});
