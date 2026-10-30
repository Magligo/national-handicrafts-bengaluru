async function readSession(api, path) {
  try {
    return await api(path);
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function resolveProfileDestination(api) {
  const admin = await readSession(api, '/auth/me');
  if (admin?.data?.role === 'admin') return { page: 'admin', profile: admin.data };

  const customer = await readSession(api, '/customer/auth/me');
  return { page: 'profile', profile: customer?.data || null };
}
