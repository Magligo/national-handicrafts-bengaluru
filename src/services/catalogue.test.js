import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheProducts, loadProducts, readCachedProducts } from './catalogue.js';

test('uses a versioned public catalogue snapshot for up to seven days', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const products = [{ id: 'verified-product', active: true, verification_status: 'verified' }, { id: 'unpublished-product', active: false, verification_status: 'verified' }];
  cacheProducts(products, storage, 1000);
  assert.deepEqual(readCachedProducts(storage, 1100), [products[0]]);
  assert.deepEqual(readCachedProducts(storage, 1000 + 7 * 24 * 60 * 60 * 1000), [products[0]]);
  assert.equal(readCachedProducts(storage, 1001 + 7 * 24 * 60 * 60 * 1000), null);
});

test('retries transient catalogue failures with a short bounded timeout and backoff', async () => {
  let calls = 0;
  const pauses = [];
  const response = await loadProducts({
    request: async (_path, options) => {
      calls += 1;
      assert.equal(options.timeout, 3500);
      if (calls < 3) throw Object.assign(new Error('temporary failure'), { status: 503 });
      return { data: [{ id: 'verified-product' }] };
    },
    pause: async (milliseconds) => pauses.push(milliseconds),
  });

  assert.equal(calls, 3);
  assert.deepEqual(pauses, [350, 700]);
  assert.equal(response.data[0].id, 'verified-product');
});

test('does not retry permanent catalogue errors', async () => {
  let calls = 0;
  await assert.rejects(loadProducts({ request: async () => { calls += 1; throw Object.assign(new Error('not found'), { status: 404 }); } }), /not found/);
  assert.equal(calls, 1);
});

test('shares an in-flight catalogue request', async () => {
  let calls = 0;
  let resolveRequest;
  const request = () => {
    calls += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const first = loadProducts({ request });
  const second = loadProducts({ request: async () => { throw new Error('should not run'); } });
  assert.equal(calls, 1);
  resolveRequest({ data: [] });
  assert.deepEqual(await first, { data: [] });
  assert.deepEqual(await second, { data: [] });
});
