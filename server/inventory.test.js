import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from './repository.js';
import { productPurchaseState } from '../shared/productAvailability.js';

function product(id, stock, extra = {}) {
  return { id, name: id, price_inr: 100, stock, availability: 'available', active: true, verification_status: 'verified', variants: [], ...extra };
}
const order = (items, key = null) => ({ requestedItems: items, customer: { name: 'A', email: 'a@example.com' }, payment_method: 'COD', payment_status: 'pending', idempotency_key: key, status: 'pending' });

test('purchase availability is consistent for all states and independently checked variants', () => {
  assert.equal(productPurchaseState(product('a', 2)).canPurchase, true);
  assert.equal(productPurchaseState(product('a', 0)).kind, 'out-of-stock');
  assert.equal(productPurchaseState(product('a', 2, { availability: 'enquiry' })).kind, 'enquiry');
  assert.equal(productPurchaseState(product('a', null, { availability: 'made_to_order' })).canPurchase, true);
  const variants = product('a', null, { variants: [{ id: 'v1', availability: 'available', price_inr: 100, stock: 1, source_review_status: 'verified' }] });
  assert.equal(productPurchaseState(variants).kind, 'choose');
  assert.equal(productPurchaseState(variants, variants.variants[0]).canPurchase, true);
  assert.equal(productPurchaseState(variants, { ...variants.variants[0], availability: 'out_of_stock' }).canPurchase, false);
});

test('a successful purchase aggregates duplicate lines and decrements stock once', async () => {
  const repo = new MemoryRepository({ products: [product('bowl', 4)] });
  const result = await repo.createOrderWithInventory(order([{ id: 'bowl', quantity: 1 }, { id: 'bowl', quantity: 2 }], 'one'));
  assert.equal(result.order.items.length, 1);
  assert.equal(result.order.items[0].quantity, 3);
  assert.equal(repo.products[0].stock, 1);
});

test('insufficient stock and failed multi-product orders leave inventory unchanged', async () => {
  const repo = new MemoryRepository({ products: [product('a', 2), product('b', 0)] });
  await assert.rejects(repo.createOrderWithInventory(order([{ id: 'a', quantity: 1 }, { id: 'b', quantity: 1 }])), /stock/i);
  assert.deepEqual(repo.products.map((item) => item.stock), [2, 0]);
  assert.equal(repo.orders.length, 0);
});

test('concurrent orders for the final unit and idempotent retries deduct at most once', async () => {
  const repo = new MemoryRepository({ products: [product('last', 1)] });
  const results = await Promise.allSettled([
    repo.createOrderWithInventory(order([{ id: 'last', quantity: 1 }], 'req-a')),
    repo.createOrderWithInventory(order([{ id: 'last', quantity: 1 }], 'req-b')),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(repo.products[0].stock, 0);
  const retryRepo = new MemoryRepository({ products: [product('retry', 2)] });
  const first = await retryRepo.createOrderWithInventory(order([{ id: 'retry', quantity: 1 }], 'same'));
  const retry = await retryRepo.createOrderWithInventory(order([{ id: 'retry', quantity: 1 }], 'same'));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.order.id, first.order.id);
  assert.equal(retryRepo.products[0].stock, 1);
});

test('cancelled orders restore finite stock once', async () => {
  const repo = new MemoryRepository({ products: [product('stock', 3), product('variant', null, { variants: [{ id: 'v', name: 'Small', price_inr: 100, stock: 2, availability: 'available', source_review_status: 'verified' }] })] });
  const base = await repo.createOrderWithInventory(order([{ id: 'stock', quantity: 1 }]));
  const variant = await repo.createOrderWithInventory(order([{ id: 'variant', variantId: 'v', quantity: 1 }]));
  await repo.updateOrderStatus(base.order.id, 'cancelled');
  await repo.updateOrderStatus(base.order.id, 'cancelled');
  await repo.updateOrderStatus(variant.order.id, 'cancelled');
  assert.equal(repo.products[0].stock, 3);
  assert.equal(repo.products[1].variants[0].stock, 2);
});
