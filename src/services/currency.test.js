import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice } from './currency.js';

test('formats whole rupee values using the Indian grouping and Unicode rupee sign', () => {
  assert.equal(formatPrice(2800), '₹2,800');
  assert.equal(formatPrice(1280000), '₹12,80,000');
  assert.equal(formatPrice(2800.5), '₹2,800.5');
});

test('formats missing or invalid prices as a request', () => {
  assert.equal(formatPrice(null), 'Price on request');
  assert.equal(formatPrice(Number.NaN), 'Price on request');
});
