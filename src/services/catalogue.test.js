import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProducts } from './catalogue.js';

test('retries transient catalogue failures and preserves the longer request timeout', async () => {
  let calls = 0;
  const pauses = [];
  const response = await loadProducts({
    request: async (_path, options) => {
      calls += 1;
      assert.equal(options.timeout, 30000);
      if (calls < 3) throw Object.assign(new Error('temporary failure'), { status: 503 });
      return { data: [{ id: 'verified-product' }] };
    },
    pause: async (milliseconds) => pauses.push(milliseconds),
  });

  assert.equal(calls, 3);
  assert.deepEqual(pauses, [1200, 3000]);
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
