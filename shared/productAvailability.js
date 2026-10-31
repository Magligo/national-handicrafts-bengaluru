export function productPurchaseState(product, variant = null) {
  if (!product) return { canPurchase: false, kind: 'unavailable', label: 'Unavailable', action: 'Unavailable' };
  if (Array.isArray(product.variants) && product.variants.length && !variant) {
    return { canPurchase: false, kind: 'choose', label: 'Choose an option', action: 'Choose options' };
  }
  if (variant && variant.source_review_status !== 'verified') {
    return { canPurchase: false, kind: 'review', label: 'Price awaiting review', action: 'Unavailable' };
  }
  const availability = variant?.availability || product.availability || 'enquiry';
  const stock = variant ? variant.stock : product.stock;
  const hasPrice = (variant ? (variant.price_inr ?? variant.price) : product.price_inr) != null;
  if (availability === 'enquiry' || !hasPrice) {
    return { canPurchase: false, kind: 'enquiry', label: 'Enquiry only', action: 'Enquire' };
  }
  if (availability === 'out_of_stock' || (availability === 'available' && (variant ? stock == null || Number(stock) <= 0 : stock != null && Number(stock) <= 0))) {
    return { canPurchase: false, kind: 'out-of-stock', label: 'Out of Stock', action: 'Unavailable' };
  }
  if (availability === 'made_to_order') {
    return { canPurchase: true, kind: 'made-to-order', label: 'Made to order', action: 'Add to cart' };
  }
  if (availability === 'available') {
    return { canPurchase: true, kind: 'available', label: stock == null ? 'Available' : 'In stock', action: 'Add to cart' };
  }
  return { canPurchase: false, kind: 'enquiry', label: 'Enquiry only', action: 'Enquire' };
}
