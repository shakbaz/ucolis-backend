// 📄 ucolis-backend/middleware/upload.js

const multer    = require('multer');
const cloudinary = require('cloudinary').v2;

// ── Config Cloudinary ─────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Multer stocke en RAM (pas sur disque) ─────────────────────
const storage     = multer.memoryStorage(); // ✅ zéro fichier local
const imageFilter = (req, file, cb) => {
  file.mimetype.startsWith('image/')
    ? cb(null, true)
    : cb(new Error('Seules les images sont acceptées'), false);
};

const uploadPhoto  = multer({ storage, fileFilter: imageFilter }).single('photo');
const uploadParcel = multer({ storage, fileFilter: imageFilter }).single('photo');

// ── Helpers upload vers Cloudinary ───────────────────────────
function uploadToCloudinary(buffer, folder, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, ...options },
      (error, result) => error ? reject(error) : resolve(result)
    );
    stream.end(buffer); // ✅ envoie le buffer RAM directement
  });
}

module.exports = { uploadPhoto, uploadParcel, uploadToCloudinary, cloudinary };
