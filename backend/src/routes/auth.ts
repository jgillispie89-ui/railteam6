import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db.js';
import { signToken } from '../token.js';
import { sendVerificationEmail } from '../email.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const hash = await bcrypt.hash(password, 12);
        const vtoken = crypto.randomBytes(32).toString('hex');
        const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'contributor';

        const { rows } = await pool.query(
            `INSERT INTO users (email, password_hash, role, verification_token)
             VALUES ($1, $2, $3, $4) RETURNING id, email, role, verified`,
            [email.toLowerCase(), hash, role, vtoken]
        );
        const u = rows[0];

        sendVerificationEmail(u.email, vtoken).catch(err =>
            console.error('Email send failed:', err.message)
        );

        const token = signToken({ id: u.id, email: u.email, role: u.role });
        res.status(201).json({ token, user: { id: u.id, email: u.email, role: u.role, verified: u.verified } });
    } catch (err: any) {
        if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
        res.status(500).json({ error: err.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email?.toLowerCase()]);
        const u = rows[0];
        if (!u || !(await bcrypt.compare(password, u.password_hash)))
            return res.status(401).json({ error: 'Invalid email or password' });

        const token = signToken({ id: u.id, email: u.email, role: u.role });
        res.json({ token, user: { id: u.id, email: u.email, role: u.role, verified: u.verified } });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/verify', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: 'Token required' });
        const { rows } = await pool.query(
            `UPDATE users SET verified = true, verification_token = NULL
             WHERE verification_token = $1 RETURNING id`,
            [token]
        );
        if (!rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/me', requireAuth, async (req, res) => {
    const { id } = (req as any).user;
    const { rows } = await pool.query(
        'SELECT id, email, role, verified, created_at FROM users WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
});

export default router;
