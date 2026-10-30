import test from 'node:test';
import assert from 'node:assert/strict';
import { animateProductToCart } from './cartAnimation.js';

function setupAnimationEnvironment({ width = 390, reducedMotion = false } = {}) {
  const flyers = [];
  const frames = [];
  const buttonAnimations = [];
  const badgeAnimations = [];
  const image = {
    currentSrc: '/products/brass-lamp.png',
    naturalWidth: 640,
    getBoundingClientRect: () => ({ left: 20, top: 180, width: width * 0.7, height: width * 0.7 }),
  };
  const badge = { animate: (...args) => badgeAnimations.push(args) };
  const cart = {
    getBoundingClientRect: () => ({ left: width - 62, top: 24, width: 42, height: 42 }),
    querySelector: (selector) => selector === '[data-cart-count]' ? badge : null,
    animate: (...args) => buttonAnimations.push(args),
  };
  const trigger = { closest: (selector) => selector === '.product-card'
    ? { querySelector: () => image }
    : null };
  const document = {
    querySelector: (selector) => selector === '[data-cart-target]' ? cart : null,
    createElement: () => {
      const flyer = { style: {}, removed: false, setAttribute() {}, remove() { this.removed = true; }, animate(keyframes, options) { this.keyframes = keyframes; this.options = options; return this.animation = {}; } };
      flyers.push(flyer);
      return flyer;
    },
    body: { append() {} },
  };
  const original = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element, requestAnimationFrame: globalThis.requestAnimationFrame };
  class FakeElement {}
  FakeElement.prototype.animate = () => {};
  globalThis.document = document;
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
  globalThis.Element = FakeElement;
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  return {
    trigger, flyers, frames, buttonAnimations, badgeAnimations,
    restore() {
      for (const key of Object.keys(original)) {
        if (original[key] === undefined) delete globalThis[key];
        else globalThis[key] = original[key];
      }
    },
  };
}

test('flies the rendered product image to the cart and cleans up on arrival', () => {
  const env = setupAnimationEnvironment({ width: 1440 });
  try {
    animateProductToCart(env.trigger);
    assert.equal(env.flyers.length, 1);
    const flyer = env.flyers[0];
    assert.equal(flyer.src, '/products/brass-lamp.png');
    assert.ok(Math.abs(parseFloat(flyer.style.width) - 1008) < 0.01);
    assert.equal(flyer.options.duration, 780);
    assert.match(flyer.keyframes.at(-1).transform, /scale\(\.18\)/);
    assert.equal(flyer.options.fill, 'forwards');
    flyer.animation.onfinish();
    assert.equal(flyer.removed, true);
    assert.equal(env.buttonAnimations.length, 1);
    assert.equal(env.badgeAnimations.length, 1);
  } finally { env.restore(); }
});

test('creates independent fly elements for rapid mobile adds', () => {
  const env = setupAnimationEnvironment({ width: 375 });
  try {
    animateProductToCart(env.trigger);
    animateProductToCart(env.trigger);
    animateProductToCart(env.trigger);
    assert.equal(env.flyers.length, 3);
    assert.notEqual(env.flyers[0], env.flyers[1]);
    assert.match(env.flyers[0].keyframes[2].transform, /translate3d\(/);
  } finally { env.restore(); }
});

test('respects reduced motion without creating a flying image', () => {
  const env = setupAnimationEnvironment({ reducedMotion: true });
  try {
    animateProductToCart(env.trigger);
    assert.equal(env.flyers.length, 0);
    assert.equal(env.frames.length, 1);
    env.frames[0]();
    assert.equal(env.buttonAnimations.length, 1);
    assert.equal(env.badgeAnimations.length, 1);
  } finally { env.restore(); }
});
