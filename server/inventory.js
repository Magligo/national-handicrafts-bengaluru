function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

export function aggregateOrderItems(items) {
  const aggregated = new Map();
  for (const item of items || []) {
    const productId = String(item?.id || item?.productId || '');
    const variantId = item?.variantId ? String(item.variantId) : null;
    const quantity = Number(item?.quantity);
    if (!productId) throw new Error('A product is required for each order item');
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Quantity must be a positive whole number');
    const key = `${productId}:${variantId || 'base'}`;
    const current = aggregated.get(key);
    const next = (current?.quantity || 0) + quantity;
    if (!Number.isSafeInteger(next)) throw new Error('Requested quantity is too large');
    aggregated.set(key, { id: productId, variantId, quantity: next });
  }
  return [...aggregated.values()];
}

export function buildOrderItems(products, requestedItems) {
  const byId = new Map(products.map((product) => [String(product.id), product]));
  return aggregateOrderItems(requestedItems).map((requested) => {
    const product = byId.get(requested.id);
    if (!product || !product.active || product.verification_status !== 'verified') throw conflict('A selected product is no longer available. Refresh the catalogue and try again.');
    const variants = Array.isArray(product.variants) ? product.variants : [];
    let variant = null;
    if (variants.length) {
      variant = variants.find((entry) => entry.id === requested.variantId);
      if (!variant) throw conflict(`Choose a valid option for ${product.name}`);
      if (variant.source_review_status !== 'verified') throw conflict(`The selected option for ${product.name} is awaiting price review`);
    } else if (requested.variantId) {
      throw conflict(`The selected option for ${product.name} is no longer available`);
    }
    const availability = variant?.availability || product.availability || 'enquiry';
    if (availability === 'enquiry') throw conflict(`${product.name} is available by enquiry only`);
    if (!['available', 'made_to_order'].includes(availability)) throw conflict(`${product.name} is not available to order`);
    const price = variant ? (variant.price_inr ?? variant.price) : product.price_inr;
    if (price == null || !Number.isSafeInteger(Number(price)) || Number(price) < 0) throw conflict(`A verified price is required for ${product.name}`);
    const stock = variant ? variant.stock : product.stock;
    if (availability === 'available' && stock != null && requested.quantity > Number(stock)) {
      throw conflict(`Insufficient stock for ${product.name}${variant ? ` (${variant.name || variant.size || 'selected option'})` : ''}`);
    }
    if (availability === 'available' && variant && stock == null) throw conflict(`Stock for the selected option of ${product.name} has not been confirmed`);
    const variantSnapshot = variant ? { id: variant.id, name: variant.name || null, size: variant.size || null, weight: variant.weight ?? null, weightUnit: variant.weight_unit || null, dimensions: variant.dimensions || null, capacity: variant.capacity || null, capacityUnit: variant.capacity_unit || null, sku: variant.sku || null } : null;
    return { productId: product.id, name: product.name, quantity: requested.quantity, unitPriceInr: Number(price), imagePath: product.image_path || null, variantId: variant?.id || null, variant: variantSnapshot, stockDeducted: availability === 'available' && stock != null };
  });
}

export function restoreLinesFromOrder(order) {
  return (Array.isArray(order?.items) ? order.items : []).filter((item) => item?.stockDeducted === true && Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0);
}
