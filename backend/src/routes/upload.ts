import { Router } from 'express';
import crypto from 'crypto';
import { requireAdmin } from '../middleware/auth.js';
import { uploadObject, signPaths } from '../storage.js';

const router = Router();

// =============================================================================
// POST /api/upload/photo — base64 WebP (full + thumb), resized in the browser,
// stored in the PRIVATE bucket. Returns object paths plus signed preview URLs.
// Body limit for this path is set in app.ts (Vercel caps bodies at ~4.5 MB).
// =============================================================================
router.post('/photo', requireAdmin, async (req, res) => {
    try {
        const { full, thumb } = req.body || {};
        if (typeof full !== 'string' || typeof thumb !== 'string')
            return res.status(400).json({ error: 'full and thumb (base64 webp) are required' });

        const stem = crypto.randomUUID();
        const fullBuf = Buffer.from(full, 'base64');
        const [storage_path, thumb_path] = await Promise.all([
            uploadObject(`photos/${stem}.webp`, fullBuf),
            uploadObject(`thumbs/${stem}.webp`, Buffer.from(thumb, 'base64')),
        ]);
        const signed = await signPaths([storage_path, thumb_path]);
        res.json({ storage_path, thumb_path, bytes: fullBuf.length,
                   url: signed[storage_path], thumb_url: signed[thumb_path] });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
