const FLY_DURATION = 780;

function pulse(element, keyframes, options) {
  if (!element || typeof element.animate !== 'function') return;
  element.animate(keyframes, { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', ...options });
}

function animateCartArrival(cartButton) {
  pulse(cartButton, [
    { transform: 'scale(1)' },
    { transform: 'scale(1.12)', offset: 0.42 },
    { transform: 'scale(.97)', offset: 0.72 },
    { transform: 'scale(1)' },
  ]);

  const badge = cartButton?.querySelector('[data-cart-count]');
  pulse(badge, [
    { transform: 'scale(1)' },
    { transform: 'scale(1.32)' },
    { transform: 'scale(1)' },
  ], { duration: 360 });
}

/** Animate the rendered product image to the shared navbar cart button. */
export function animateProductToCart(trigger) {
  const cartButton = document.querySelector('[data-cart-target]');
  if (!cartButton) return;

  const image = trigger?.closest('.product-card')?.querySelector('.product-image img')
    || trigger?.closest('.detail-grid')?.querySelector('.detail-image img');
  const start = image?.getBoundingClientRect();
  const end = cartButton.getBoundingClientRect();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (reducedMotion || !image || !image.currentSrc || !image.naturalWidth
      || !start?.width || !start?.height || !end.width || !end.height
      || typeof Element.prototype.animate !== 'function') {
    requestAnimationFrame(() => animateCartArrival(cartButton));
    return;
  }

  const flyer = document.createElement('img');
  flyer.className = 'cart-fly-image';
  flyer.src = image.currentSrc;
  flyer.alt = '';
  flyer.setAttribute('aria-hidden', 'true');
  Object.assign(flyer.style, {
    position: 'fixed',
    left: `${start.left}px`,
    top: `${start.top}px`,
    width: `${start.width}px`,
    height: `${start.height}px`,
  });
  document.body.append(flyer);

  const dx = end.left + end.width / 2 - (start.left + start.width / 2);
  const dy = end.top + end.height / 2 - (start.top + start.height / 2);
  const animation = flyer.animate([
    { transform: 'translate3d(0, 0, 0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
    { transform: `translate3d(${dx * 0.34}px, ${dy * 0.34 - 34}px, 0) scale(.72) rotate(5deg)`, opacity: 1, offset: 0.36 },
    { transform: `translate3d(${dx * 0.72}px, ${dy * 0.68 - 42}px, 0) scale(.4) rotate(11deg)`, opacity: 0.92, offset: 0.72 },
    { transform: `translate3d(${dx}px, ${dy}px, 0) scale(.18) rotate(15deg)`, opacity: 0, offset: 1 },
  ], { duration: FLY_DURATION, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'forwards' });

  animation.onfinish = () => {
    flyer.remove();
    animateCartArrival(cartButton);
  };
  animation.oncancel = () => flyer.remove();
}
