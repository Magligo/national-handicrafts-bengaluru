export const serverConfig = {
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET,
  customerSessionSecret: process.env.CUSTOMER_SESSION_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
};

export function paymentConfig() {
  const upiId = (process.env.PAYMENT_UPI_ID || process.env.UPI_ID || '').trim();
  const payeeName = (process.env.PAYMENT_UPI_PAYEE_NAME || process.env.UPI_PAYEE_NAME || '').trim();
  return { enabled: Boolean(upiId && payeeName), upiId: upiId || null, payeeName: payeeName || null };
}
