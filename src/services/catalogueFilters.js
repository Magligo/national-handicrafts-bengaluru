function isInStock(product) {
  return product.stock == null ? product.availability === 'available' : Number(product.stock) > 0;
}

export function filterAndSortProducts(products, { query = '', category = '', minPrice = '', maxPrice = '', availability = 'all', sort = 'featured' } = {}) {
  const needle = query.trim().toLowerCase();
  const minimum = minPrice === '' ? null : Number(minPrice);
  const maximum = maxPrice === '' ? null : Number(maxPrice);
  const result = products.filter((product) => {
    const searchable = `${product.name || ''} ${product.category || ''} ${product.sku || ''} ${product.description || ''}`.toLowerCase();
    const price = product.price_inr == null ? null : Number(product.price_inr);
    return (!needle || searchable.includes(needle)) && (!category || product.category === category) && (minimum == null || (price != null && price >= minimum)) && (maximum == null || (price != null && price <= maximum)) && (availability !== 'in-stock' || isInStock(product));
  });
  if (sort === 'price-asc') return result.sort((a, b) => (a.price_inr == null ? Number.MAX_SAFE_INTEGER : a.price_inr) - (b.price_inr == null ? Number.MAX_SAFE_INTEGER : b.price_inr));
  if (sort === 'price-desc') return result.sort((a, b) => (b.price_inr == null ? -1 : b.price_inr) - (a.price_inr == null ? -1 : a.price_inr));
  if (sort === 'name') return result.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'newest') return result.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return result;
}
