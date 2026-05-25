import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { uploadWebp } from '../storage.js';

const router = Router();

// =============================================================================
// POST /api/upload/photo — accepts base64-encoded WebP (full + thumb), already
// resized client-side, and uploads both to Supabase Storage. Returns the public
// URLs. (Replaces the old R2 presigned-URL flow.)
//
// The larger JSON body limit for this path is configured in app.ts.
// =============================================================================
router.post('/photo', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        if (!user.verified)
            return res.status(403).json({ error: 'Verify your email before uploading photos' });

        const { full, thumb } = req.body || {};
        if (typeof full !== 'string' || typeof thumb !== 'string')
            return res.status(400).json({ error: 'full and thumb (base64 webp) are required' });

        const stem = crypto.randomUUID();
        const [url, thumb_url] = await Promise.all([
            uploadWebp(`photos/${stem}.webp`, Buffer.from(full, 'base64')),
            uploadWebp(`thumbs/${stem}.webp`, Buffer.from(thumb, 'base64')),
        ]);

        res.json({ url, thumb_url });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
