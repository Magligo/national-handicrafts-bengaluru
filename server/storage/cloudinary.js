import { v2 as cloudinary } from 'cloudinary';

const folder = 'national-handicrafts/products';

export function cloudinaryConfigurationError() {
  const error = new Error('Cloudinary image storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in the backend .env for local development or in the Render backend environment for production.');
  error.status = 503;
  error.code = 'CLOUDINARY_CONFIG_MISSING';
  return error;
}

function hasCloudinaryConfig() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

if (hasCloudinaryConfig()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export function cloudinaryConfigured() {
  return hasCloudinaryConfig();
}

async function uploadImage(file, targetFolder) {
  if (!cloudinaryConfigured()) throw cloudinaryConfigurationError();
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
    stream.end(file.buffer);
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
  if (!cloudinaryConfigured()) throw cloudinaryConfigurationError();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'national-handicrafts/gallery', resource_type: 'video', use_filename: false, unique_filename: true, overwrite: false }, (error, result) => {
      if (error || !result?.secure_url) {
        const uploadError = new Error('Cloudinary could not store the gallery video. Check the backend logs and Cloudinary availability.');
        uploadError.status = 502; uploadError.code = 'CLOUDINARY_UPLOAD_FAILED'; return reject(uploadError);
      }
      resolve({ url: result.secure_url, publicId: result.public_id, thumbnailUrl: result.secure_url.replace(/\.[^./?]+(?:\?.*)?$/, '.jpg') });
    });
    stream.end(file.buffer);
  });
}

export async function deleteGalleryImage(publicId) {
  if (!cloudinaryConfigured()) throw cloudinaryConfigurationError();
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
  if (!cloudinaryConfigured()) throw cloudinaryConfigurationError();
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'video', invalidate: true });
  if (!['ok', 'not found'].includes(result?.result)) { const error = new Error('Cloudinary could not delete the gallery video.'); error.status = 502; error.code = 'CLOUDINARY_DELETE_FAILED'; throw error; }
  return result;
}

export async function uploadShopBannerMedia(file) {
  if (!cloudinaryConfigured()) throw cloudinaryConfigurationError();
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
    stream.end(file.buffer);
  });
}
