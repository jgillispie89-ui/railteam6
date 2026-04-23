import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db.js';
import { signToken } from '../token.js';
import { sendVerificationEmail, sendAdminNotificationEmail } from '../email.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

// =============================================================================
// POST /api/auth/register
// =============================================================================
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const hash        = await bcrypt.hash(password, 12);
        const vtoken      = crypto.randomBytes(32).toString('hex');
        const vexpiry     = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const role        = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'contributor';
        const displayName = email.split('@')[0];

        const { rows } = await pool.query(
            `INSERT INTO users (email, display_name, password_hash, role, verification_token, verification_token_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, email, role`,
            [email.toLowerCase(), displayName, hash, role, vtoken, vexpiry]
        );
        const u = rows[0];

        sendVerificationEmail(u.email, vtoken).catch(err =>
            console.error('Verification email failed:', err.message)
        );
        sendAdminNotificationEmail(u.email, u.id).catch(err =>
            console.error('Admin notification failed:', err.message)
        );

        const token = signToken({ id: u.id, email: u.email, role: u.role, verified: false });
        res.status(201).json({ token, user: { id: u.id, email: u.email, role: u.role, verified: false } });
    } catch (err: any) {
        if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/auth/login
// =============================================================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE email = $1', [email?.toLowerCase()]
        );
        const u = rows[0];
        if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash)))
            return res.status(401).json({ error: 'Invalid email or password' });

        const token = signToken({ id: u.id, email: u.email, role: u.role, verified: u.verified });
        res.json({ token, user: { id: u.id, email: u.email, role: u.role, verified: u.verified } });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// GET /api/auth/verify?token=XXX
// Returns a fresh JWT with verified: true on success
// =============================================================================
router.get('/verify', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: 'Token required' });

        const { rows } = await pool.query(
            `UPDATE users
             SET verified = true, verification_token = NULL, verification_token_expires_at = NULL
             WHERE verification_token = $1
               AND verification_token_expires_at > NOW()
             RETURNING id, email, role`,
            [token]
        );
        if (!rows.length) return res.status(400).json({ error: 'Invalid or expired verification link' });

        const u = rows[0];
        const newToken = signToken({ id: u.id, email: u.email, role: u.role, verified: true });
        res.json({ ok: true, token: newToken });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/auth/resend-verification
// Throttled: one email per 5 minutes
// =============================================================================
router.post('/resend-verification', requireAuth, async (req, res) => {
    try {
        const { id } = (req as any).user;
        const { rows } = await pool.query(
            'SELECT email, verified, verification_token_expires_at FROM users WHERE id = $1', [id]
        );
        const u = rows[0];
        if (!u) return res.status(404).json({ error: 'User not found' });
        if (u.verified) return res.json({ ok: true, message: 'Already verified' });

        if (u.verification_token_expires_at) {
            const expiresAt  = new Date(u.verification_token_expires_at).getTime();
            const lastSentAt = expiresAt - 48 * 60 * 60 * 1000;
            const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
            if (lastSentAt > fiveMinsAgo) {
                return res.status(429).json({ error: 'Please wait 5 minutes before requesting another verification email' });
            }
        }

        const vtoken  = crypto.randomBytes(32).toString('hex');
        const vexpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
        await pool.query(
            'UPDATE users SET verification_token = $1, verification_token_expires_at = $2 WHERE id = $3',
            [vtoken, vexpiry, id]
        );

        sendVerificationEmail(u.email, vtoken).catch(err =>
            console.error('Resend verification failed:', err.message)
        );
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// GET /api/auth/me
// =============================================================================
router.get('/me', requireAuth, async (req, res) => {
    const { id } = (req as any).user;
    const { rows } = await pool.query(
        'SELECT id, email, role, verified, created_at FROM users WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
});

export default router;
