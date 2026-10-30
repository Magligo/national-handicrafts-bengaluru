function requiredEmailConfig(env) {
  return Boolean(env.RESEND_API_KEY && env.PASSWORD_RESET_FROM_EMAIL);
}

export function emailDeliveryConfigured(env = process.env) {
  return requiredEmailConfig(env);
}

export async function sendEmail({ to, subject, text }, { env = process.env, fetchImpl = fetch } = {}) {
  if (!requiredEmailConfig(env)) throw new Error('Email delivery is not configured');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.PASSWORD_RESET_FROM_EMAIL, to: [to], subject, text }),
  });
  if (!response.ok) throw new Error('Email delivery failed');
}

export async function sendPasswordResetEmail({ email, resetUrl }) {
  return sendEmail({ to: email, subject: 'Reset your National Handicrafts password', text: `Use this secure link to reset your password. It expires in 30 minutes and can be used once:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.` });
}
