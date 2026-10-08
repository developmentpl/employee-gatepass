import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { HttpError } from '../util.js';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/uploads by default; UPLOAD_DIR (or a Railway volume) when set
export const UPLOAD_DIR = config.uploadDir ? path.resolve(config.uploadDir) : path.resolve(__dirname, '../../uploads');
export const PHOTO_DIR = path.join(UPLOAD_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

/** multer instance keeping files in memory (photos and spreadsheets are small). */
export const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/**
 * Save a photo coming either as a multipart file (req.file) or a webcam data URL (req.body.dataUrl).
 * Returns the public path, e.g. /uploads/photos/abc.jpg
 */
export function savePhoto(req, prefix = 'u') {
  let buf, mime;
  if (req.file) {
    buf = req.file.buffer;
    mime = req.file.mimetype;
  } else if (req.body?.dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(req.body.dataUrl);
    if (!m) throw new HttpError(400, 'Invalid image data');
    mime = m[1];
    buf = Buffer.from(m[2], 'base64');
  } else {
    throw new HttpError(400, 'No photo received');
  }
  if (!EXT[mime]) throw new HttpError(400, 'Photo must be JPG, PNG or WEBP');
  if (buf.length > 5 * 1024 * 1024) throw new HttpError(400, 'Photo must be under 5 MB');
  const safePrefix = String(prefix).replace(/[^A-Za-z0-9_-]/g, '');
  const name = `${safePrefix}-${crypto.randomBytes(8).toString('hex')}${EXT[mime]}`;
  fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
  return `/uploads/photos/${name}`;
}

export function removePhoto(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/photos/')) return;
  const f = path.join(PHOTO_DIR, path.basename(publicPath));
  fs.promises.unlink(f).catch(() => {});
}
