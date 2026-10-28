const categories = ['Brass', 'Copper', 'Puja Articles', 'Dining & Thali Sets', 'Decorative Handicrafts'];
const statuses = ['pending', 'verified', 'rejected'];
const orderStatuses = ['enquiry', 'pending', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'completed', 'cancelled'];
const paymentMethods = ['COD', 'UPI'];
const availabilityValues = ['available', 'out_of_stock', 'made_to_order', 'enquiry'];
function optionalText(value, max = 500) { const text = String(value ?? '').trim(); if (text.length > max) throw new Error(`Text fields must be ${max} characters or fewer`); return text; }
export function productInput(body = {}, { partial = false } = {}) {
  const value = {};
  if (!partial || body.name !== undefined) value.name = optionalText(body.name, 200);
  if (!partial || body.category !== undefined) value.category = optionalText(body.category, 80);
  if (!partial || body.description !== undefined) value.description = optionalText(body.description, 5000);
  if (!partial || body.price !== undefined) value.price_inr = body.price === '' || body.price == null ? null : Number(body.price);
  if (!partial || body.discountPercent !== undefined || body.discount_percent !== undefined) { const discount = body.discountPercent ?? body.discount_percent; value.discount_percent = discount === '' || discount == null ? null : Number(discount); }
  if (!partial || body.stock !== undefined) value.stock = body.stock === '' || body.stock == null ? null : Number(body.stock);
  if (!partial || body.variants !== undefined) { try { value.variants = typeof body.variants === 'string' ? JSON.parse(body.variants || '[]') : (body.variants ?? []); } catch { throw new Error('Variants must be valid JSON'); } }
  if (!partial || body.unit !== undefined) value.unit = optionalText(body.unit, 80) || null;
  if (!partial || body.dimensions !== undefined) value.dimensions = optionalText(body.dimensions, 200) || null;
  if (!partial || body.weight !== undefined) value.weight = optionalText(body.weight, 100) || null;
  if (!partial || body.material !== undefined) value.material = optionalText(body.material, 200) || null;
  if (!partial || body.finish !== undefined) value.finish = optionalText(body.finish, 200) || null;
  if (!partial || body.availability !== undefined) value.availability = optionalText(body.availability, 40) || 'enquiry';
  if (!partial || body.sku !== undefined) value.sku = body.sku ? optionalText(body.sku, 100) : null;
  if (!partial || body.sourceCatalogue !== undefined || body.source_catalogue !== undefined) value.source_catalogue = optionalText(body.sourceCatalogue ?? body.source_catalogue, 300) || null;
  if (!partial || body.sourcePage !== undefined || body.source_page !== undefined) value.source_page = body.sourcePage ?? body.source_page ? Number(body.sourcePage ?? body.source_page) : null;
  if (!partial || body.verificationStatus !== undefined || body.verification_status !== undefined) { const status = body.verificationStatus ?? body.verification_status; value.verification_status = statuses.includes(status) ? status : 'pending'; }
  if (!partial || body.active !== undefined) value.active = body.active === undefined ? true : body.active === true || body.active === 'true';
  if ((!partial && !value.name) || (!partial && !value.category)) throw new Error('Name and category are required');
  if (value.price_inr !== null && value.price_inr !== undefined && (!Number.isInteger(value.price_inr) || value.price_inr < 0)) throw new Error('Price must be a non-negative whole number or blank');
  if (value.discount_percent !== null && value.discount_percent !== undefined && (!Number.isFinite(value.discount_percent) || value.discount_percent < 0 || value.discount_percent > 100)) throw new Error('Discount must be between 0 and 100 percent');
  if (value.stock !== null && value.stock !== undefined && (!Number.isInteger(value.stock) || value.stock < 0)) throw new Error('Stock must be a non-negative whole number or blank');
  if (value.source_page !== null && value.source_page !== undefined && (!Number.isInteger(value.source_page) || value.source_page < 1)) throw new Error('Source page must be a positive whole number');
  if (value.category && !categories.includes(value.category)) throw new Error(`Category must be one of: ${categories.join(', ')}`);
  if (value.availability && !availabilityValues.includes(value.availability)) throw new Error(`Availability must be one of: ${availabilityValues.join(', ')}`);
  if (!Array.isArray(value.variants)) throw new Error('Variants must be an array');
  return value;
}
export function validateOrder(body) {
  const customer = body?.customer || {};
  if (!customer.name || customer.name.trim().length > 160) throw new Error('Customer name is required');
  if (!/^\S+@\S+\.\S+$/.test(customer.email || '')) throw new Error('A valid email is required');
  if (!/^\+?[0-9 ()-]{7,20}$/.test(customer.phone || '')) throw new Error('A valid mobile number is required');
  for (const [key, label, max] of [['address', 'Delivery address', 500], ['city', 'City', 100], ['state', 'State', 100]]) if (!customer[key] || customer[key].trim().length > max) throw new Error(`${label} is required`);
  if (customer.district && customer.district.trim().length > 100) throw new Error('District is too long');
  if (!/^\d{6}$/.test(customer.pin || '')) throw new Error('A valid 6-digit PIN code is required');
  if (customer.instructions && customer.instructions.length > 500) throw new Error('Delivery instructions are too long');
  if (!Array.isArray(body.items) || !body.items.length) throw new Error('At least one item is required');
  if (!paymentMethods.includes(String(body.paymentMethod || 'UPI').toUpperCase())) throw new Error('Payment method must be COD or UPI');
  return body;
}
function validEmail(value) { return /^\S+@\S+\.\S+$/.test(String(value || '').trim().toLowerCase()); }
export function customerRegistrationInput(body = {}) { const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || ''); const name = optionalText(body.name, 160); if (!name) throw new Error('Full name is required'); if (!validEmail(email)) throw new Error('A valid email is required'); if (password.length < 8 || password.length > 200) throw new Error('Password must be between 8 and 200 characters'); return { name, email, password }; }
export function adminPasswordChangeInput(body = {}) { const currentPassword = String(body.currentPassword || ''); const newPassword = String(body.newPassword || ''); if (!currentPassword) throw new Error('Current password is required'); if (newPassword.length < 8 || newPassword.length > 200) throw new Error('New password must be between 8 and 200 characters'); return { currentPassword, newPassword }; }
export function customerProfileInput(body = {}) { const value = {}; if (body.name !== undefined) value.name = optionalText(body.name, 160); if (body.phone !== undefined) { const phone = optionalText(body.phone, 30); if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw new Error('A valid mobile number is required'); value.phone = phone || null; } if (body.address !== undefined) value.address = optionalText(body.address, 500) || null; if (body.city !== undefined) value.city = optionalText(body.city, 100) || null; if (body.state !== undefined) value.state = optionalText(body.state, 100) || null; if (body.pin !== undefined) { const pin = optionalText(body.pin, 6); if (pin && !/^\d{6}$/.test(pin)) throw new Error('A valid 6-digit PIN code is required'); value.pin = pin || null; } if (body.name !== undefined && !value.name) throw new Error('Full name is required'); return value; }
export function addressInput(body = {}) { const value = { label: optionalText(body.label, 60), recipient_name: optionalText(body.recipientName ?? body.recipient_name, 160), phone: optionalText(body.phone, 30), address: optionalText(body.address, 500), city: optionalText(body.city, 100), state: optionalText(body.state, 100), pin: optionalText(body.pin, 6), is_default: body.isDefault === true || body.is_default === true }; if (!value.label || !value.recipient_name || !value.phone || !value.address || !value.city || !value.state || !/^\+?[0-9 ()-]{7,20}$/.test(value.phone) || !/^\d{6}$/.test(value.pin)) throw new Error('Complete address details are required'); return value; }
export { categories, statuses, orderStatuses, availabilityValues, paymentMethods };
