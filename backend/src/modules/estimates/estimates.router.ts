import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';

import { requireAuth } from '../../middleware/require-auth.js';
import { AppError } from '../../utils/app-error.js';
import { analyzePhoto, searchFoods } from './estimates.controller.js';

// The client already downscales to ~1024px / JPEG q0.85, which lands well under 1 MB.
// The cap is headroom for an un-processed upload, not the expected size.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Photos are held in memory and dropped after the request — they are never written to
// disk and never persisted (ARCHITECTURE.md §1.6).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    // Rejecting with `cb(null, false)` would silently drop the file and surface as a
    // confusing "photo is required"; an explicit error says what was actually wrong.
    cb(new AppError('The photo must be a JPEG, PNG or WebP image', 400));
  },
});

/**
 * multer signals its own failures with `MulterError`, which the global handler would
 * report as a 500. Translating here keeps multer knowledge inside this module instead of
 * leaking it into `error-handler.ts`.
 */
function uploadPhoto(req: Request, res: Response, next: NextFunction) {
  upload.single('photo')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(
        err.code === 'LIMIT_FILE_SIZE'
          ? new AppError('The photo is too large (max 5 MB)', 413)
          : new AppError('Invalid photo upload', 400),
      );
      return;
    }
    next(err);
  });
}

export const estimatesRouter = Router();

// Costs real money per call and reveals the provider key's existence — auth required.
estimatesRouter.use(requireAuth);

estimatesRouter.post('/photo', uploadPhoto, analyzePhoto);
// Not mounted under /api/foods: ARCHITECTURE.md §4.2 reserves that for the user's own
// custom-foods CRUD. This is an FDC proxy, and the key must stay server-side.
estimatesRouter.get('/foods', searchFoods);
