import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfileDestination } from './profileSession.js';

function unauthorized() { const error = new Error('Session expired'); error.status = 401; return error; }

test('routes a verified admin session directly to the admin dashboard', async () => {
  const calls = [];
  const result = await resolveProfileDestination(async (path) => {
    calls.push(path);
    if (path === '/auth/me') return { data: { id: 'a1', role: 'admin' } };
    throw new Error('Customer check should not run for an admin.');
  });
  assert.deepEqual(result, { page: 'admin', profile: { id: 'a1', role: 'admin' } });
  assert.deepEqual(calls, ['/auth/me']);
});

test('routes a verified customer to their account after the admin session check fails', async () => {
  const calls = [];
  const profile = { id: 'c1', email: 'customer@example.com' };
  const result = await resolveProfileDestination(async (path) => {
    calls.push(path);
    if (path === '/auth/me') throw unauthorized();
    return { data: profile };
  });
  assert.deepEqual(result, { page: 'profile', profile });
  assert.deepEqual(calls, ['/auth/me', '/customer/auth/me']);
});

test('routes expired or missing sessions to customer login', async () => {
  const result = await resolveProfileDestination(async () => { throw unauthorized(); });
  assert.deepEqual(result, { page: 'profile', profile: null });
});

test('does not treat an unavailable authentication service as a signed-out session', async () => {
  const failure = new Error('Authentication service unavailable');
  await assert.rejects(resolveProfileDestination(async () => { throw failure; }), failure);
});
