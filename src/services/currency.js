const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatPrice(value) {
  if (value === null || value === undefined || value === '') return 'Price on request';
  const amount = Number(value);
  return Number.isFinite(amount) ? inrFormatter.format(amount) : 'Price on request';
}
