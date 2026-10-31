import { v2 as cloudinary } from 'cloudinary';
import { createReadStream } from 'node:fs';

const folder = 'national-handicrafts/products';
function pipeFile(file, destination, reject) { const source = createReadStream(file.path); source.once('error', reject); source.pipe(destination); }

const cloudinaryKeys = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];

export function cloudinaryConfigurationStatus(env = process.env) {
  const missing = cloudinaryKeys.filter((key) => !String(env[key] || '').trim());
  return { configured: missing.length === 0, missing };
}

export function cloudinaryConfigurationError(missing = cloudinaryKeys) {
  const error = new Error(`Cloudinary media storage is not configured. Add ${missing.join(', ')} to the backend .env for local development or the backend hosting environment for production.`);
  error.status = 503;
  error.code = 'CLOUDINARY_CONFIG_MISSING';
  return error;
}

export function cloudinaryConfigured() {
  return cloudinaryConfigurationStatus().configured;
}

function configureCloudinary() {
  const status = cloudinaryConfigurationStatus();
  if (!status.configured) throw cloudinaryConfigurationError(status.missing);
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(), api_key: process.env.CLOUDINARY_API_KEY.trim(), api_secret: process.env.CLOUDINARY_API_SECRET.trim(), secure: true });
}

async function uploadImage(file, targetFolder) {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: targetFolder,
      resource_type: 'image',
      use_filename: false,
      unique_filename: true,
      overwrite: false,
    }, (error, result) => {
      if (error || !result?.secure_url) {
        const uploadError = new Error('Cloudinary could not store the product image. Check the backend logs and Cloudinary availability.');
        uploadError.status = 502;
        uploadError.code = 'CLOUDINARY_UPLOAD_FAILED';
        return reject(uploadError);
      }
      resolve({ url: result.secure_url, publicId: result.public_id });
    });
    if (file.path) pipeFile(file, stream, reject);
    else stream.end(file.buffer);
  });
}

export function uploadProductImage(file) {
  return uploadImage(file, folder);
}

export function uploadGalleryImage(file) {
  return uploadImage(file, 'national-handicrafts/gallery');
}

export async function uploadGalleryMedia(file) {
  if (file.mimetype.startsWith('image/')) return uploadGalleryImage(file);
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'national-handicrafts/gallery', resource_type: 'video', use_filename: false, unique_filename: true, overwrite: false }, (error, result) => {
      if (error || !result?.secure_url) {
        const uploadError = new Error('Cloudinary could not store the gallery video. Check the backend logs and Cloudinary availability.');
        uploadError.status = 502; uploadError.code = 'CLOUDINARY_UPLOAD_FAILED'; return reject(uploadError);
      }
      resolve({ url: result.secure_url, publicId: result.public_id, thumbnailUrl: result.secure_url.replace(/\.[^./?]+(?:\?.*)?$/, '.jpg') });
    });
    if (file.path) pipeFile(file, stream, reject);
    else stream.end(file.buffer);
  });
}

export async function deleteGalleryImage(publicId) {
  configureCloudinary();
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
  if (!['ok', 'not found'].includes(result?.result)) {
    const error = new Error('Cloudinary could not delete the gallery image.');
    error.status = 502;
    error.code = 'CLOUDINARY_DELETE_FAILED';
    throw error;
  }
  return result;
}

export async function deleteGalleryMedia(publicId, mediaType = 'photo') {
  if (mediaType !== 'video') return deleteGalleryImage(publicId);
  configureCloudinary();
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'video', invalidate: true });
  if (!['ok', 'not found'].includes(result?.result)) { const error = new Error('Cloudinary could not delete the gallery video.'); error.status = 502; error.code = 'CLOUDINARY_DELETE_FAILED'; throw error; }
  return result;
}

export async function deleteCloudinaryMedia(publicId, mediaType = 'image') {
  if (!publicId) return null;
  configureCloudinary();
  const resourceType = mediaType === 'video' ? 'video' : 'image';
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  if (!['ok', 'not found'].includes(result?.result)) {
    const error = new Error('Cloudinary could not delete the stored media.');
    error.status = 502;
    error.code = 'CLOUDINARY_DELETE_FAILED';
    throw error;
  }
  return result;
}

export async function uploadShopBannerMedia(file) {
  configureCloudinary();
  const isVideo = file.mimetype === 'video/mp4' || file.mimetype === 'video/webm';
  const resourceType = isVideo ? 'video' : 'image';
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: 'national-handicrafts/shop-banners',
      resource_type: resourceType,
      use_filename: false,
      unique_filename: true,
      overwrite: false,
    }, (error, result) => {
      if (error || !result?.secure_url) {
        const uploadError = new Error('Cloudinary could not store the banner media. Check the backend logs and Cloudinary availability.');
        uploadError.status = 502;
        uploadError.code = 'CLOUDINARY_UPLOAD_FAILED';
        return reject(uploadError);
      }
      resolve({ url: result.secure_url, publicId: result.public_id, mediaType: isVideo ? 'video' : 'image' });
    });
    if (file.path) pipeFile(file, stream, reject);
    else stream.end(file.buffer);
  });
}
