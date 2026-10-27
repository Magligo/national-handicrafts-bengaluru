export const NEUTRAL_IMAGE_FALLBACK = '/assets/image-placeholder.svg';

export function resolveImageUrl(path, origin) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  if (!origin) return path;
  return new URL(path, `${origin.replace(/\/+$/, '')}/`).toString();
}
