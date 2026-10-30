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

export async function uploadProductImage(file) {
  if (!cloudinaryConfigured()) throw cloudinaryConfigurationError();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder,
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
