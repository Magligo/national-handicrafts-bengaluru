import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortProducts } from './catalogueFilters.js';

const products = [
  { name: 'Brass Diya', category: 'Brass', sku: 'BR-1', description: 'Hand-finished lamp', price_inr: 800, stock: 3, created_at: '2025-01-01' },
  { name: 'Copper Thali', category: 'Dining & Thali Sets', sku: 'CO-1', description: 'Dining set', price_inr: 1800, stock: 0, created_at: '2025-02-01' },
  { name: 'Puja Bell', category: 'Puja Articles', sku: 'PU-1', description: 'Temple bell', price_inr: 450, stock: 2, created_at: '2025-03-01' },
];

test('combines search, category, price and availability filters', () => {
  const result = filterAndSortProducts(products, { query: 'lamp', category: 'Brass', minPrice: '500', maxPrice: '1000', availability: 'in-stock' });
  assert.deepEqual(result.map((product) => product.name), ['Brass Diya']);
});

test('searches SKU, category and description without changing the source list', () => {
  assert.deepEqual(filterAndSortProducts(products, { query: 'CO-1' }).map((product) => product.name), ['Copper Thali']);
  assert.deepEqual(filterAndSortProducts(products, { query: 'puja' }).map((product) => product.name), ['Puja Bell']);
  assert.equal(products.length, 3);
});

test('supports all catalogue sort orders', () => {
  assert.deepEqual(filterAndSortProducts(products, { sort: 'price-asc' }).map((product) => product.name), ['Puja Bell', 'Brass Diya', 'Copper Thali']);
  assert.deepEqual(filterAndSortProducts(products, { sort: 'price-desc' }).map((product) => product.name), ['Copper Thali', 'Brass Diya', 'Puja Bell']);
  assert.deepEqual(filterAndSortProducts(products, { sort: 'name' }).map((product) => product.name), ['Brass Diya', 'Copper Thali', 'Puja Bell']);
  assert.deepEqual(filterAndSortProducts(products, { sort: 'newest' }).map((product) => product.name), ['Puja Bell', 'Copper Thali', 'Brass Diya']);
});
