import test from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_IMAGE_FALLBACK, resolveImageUrl } from './image.js';

test('resolves relative product images against the Render asset origin', () => {
  assert.equal(
    resolveImageUrl('/uploads/products/example.png', 'https://national-handicrafts-bengaluru.onrender.com'),
    'https://national-handicrafts-bengaluru.onrender.com/uploads/products/example.png',
  );
});

test('preserves absolute image URLs', () => {
  assert.equal(resolveImageUrl('https://res.cloudinary.com/national-handicrafts/image/upload/product.png', 'https://national-handicrafts-bengaluru.onrender.com'), 'https://res.cloudinary.com/national-handicrafts/image/upload/product.png');
});

test('uses a neutral fallback instead of the brand logo', () => {
  assert.equal(NEUTRAL_IMAGE_FALLBACK, '/assets/image-placeholder.svg');
  assert.notEqual(NEUTRAL_IMAGE_FALLBACK, '/assets/heritage-emblem.png');
});
