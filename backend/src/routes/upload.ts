import { Router } from 'express';
import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

// Mint a presigned PUT URL for a single object. The browser uploads the (already
// client-resized) WebP blob directly to R2 with Content-Type: image/webp.
async function presign(key: string) {
    const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME!,
            Key: key,
            ContentType: 'image/webp',
        }),
        { expiresIn: 300 }
    );
    return { key, uploadUrl, publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` };
}

// =============================================================================
// POST /api/upload/presign — returns presigned PUT URLs for full + thumb.
// Replaces the old multipart /photo endpoint (server-side sharp resize). Resizing
// now happens client-side; this keeps heavy native deps off the serverless function
// and avoids Vercel's ~4.5 MB request-body limit.
// =============================================================================
router.post('/presign', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        if (!user.verified)
            return res.status(403).json({ error: 'Verify your email before uploading photos' });

        const stem = crypto.randomUUID();
        const [full, thumb] = await Promise.all([
            presign(`photos/${stem}.webp`),
            presign(`thumbs/${stem}.webp`),
        ]);
        res.json({ full, thumb });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

export default router;
