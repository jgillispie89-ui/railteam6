import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../email.js';

const router = Router();

router.get('/queue', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT s.id, s.name, s.site_type, s.status AS site_status, s.mod_status,
                   s.city, s.state_province, s.built_year, s.closed_year, s.demolished_year,
                   s.description, ST_AsGeoJSON(s.geom)::json AS geometry,
                   u.email AS submitted_by, s.created_at, s.mod_note
            FROM sites s
            LEFT JOIN users u ON u.id = s.submitted_by
            WHERE s.mod_status = 'pending'
            ORDER BY s.created_at DESC
        `);
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/approve/:id', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE sites SET mod_status = 'approved', mod_note = $2 WHERE id = $1 RETURNING id, name`,
            [req.params.id, req.body.note || null]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true, site: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/reject/:id', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE sites SET mod_status = 'rejected', mod_note = $2 WHERE id = $1 RETURNING id, name`,
            [req.params.id, req.body.note || null]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true, site: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// GET /api/admin/unverified-users — list all users who haven't verified yet
// =============================================================================
router.get('/unverified-users', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT id, email, verified, email_send_failed, email_send_error, created_at
            FROM users
            WHERE verified = false
            ORDER BY created_at DESC
        `);
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/admin/verify-user — manually mark a user verified by email address
// User will need to log out and log back in for their JWT to reflect verified: true.
// =============================================================================
router.post('/verify-user', requireAdmin, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });
        const { rows } = await pool.query(
            `UPDATE users
             SET verified = true,
                 verification_token = NULL,
                 verification_token_expires_at = NULL,
                 email_send_failed = false,
                 email_send_error = NULL
             WHERE LOWER(email) = LOWER($1)
             RETURNING id, email, role`,
            [email]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });
        res.json({ ok: true, user: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// GET /api/admin/feedback/new-count — badge count for nav
// =============================================================================
router.get('/feedback/new-count', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM feedback WHERE status = 'new'`);
        res.json({ count: parseInt(rows[0].count, 10) });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// GET /api/admin/feedback — list all; ?show_all=1 includes resolved/dismissed
// =============================================================================
router.get('/feedback', requireAdmin, async (req, res) => {
    try {
        const showAll = req.query.show_all === '1';
        const { rows } = await pool.query(
            showAll
                ? `SELECT * FROM feedback ORDER BY created_at DESC`
                : `SELECT * FROM feedback WHERE status NOT IN ('resolved','dismissed') ORDER BY created_at DESC`
        );
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// PATCH /api/admin/feedback/:id — update status and/or admin_notes
// =============================================================================
router.patch('/feedback/:id', requireAdmin, async (req, res) => {
    try {
        const sets: string[] = ['updated_at = NOW()'];
        const params: any[]  = [];
        let i = 1;
        if (req.body.status      !== undefined) { sets.push(`status      = $${i++}`); params.push(req.body.status); }
        if (req.body.admin_notes !== undefined) { sets.push(`admin_notes = $${i++}`); params.push(req.body.admin_notes || null); }
        params.push(req.params.id);
        const { rows } = await pool.query(
            `UPDATE feedback SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
            params
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// DELETE /api/admin/feedback/:id
// =============================================================================
router.delete('/feedback/:id', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `DELETE FROM feedback WHERE id = $1 RETURNING id`, [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/admin/send-password-reset — trigger a reset email for any user by email
// Bypasses the per-user rate limit. Awaits send so admin gets a real error if it fails.
// =============================================================================
router.post('/send-password-reset', requireAdmin, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });

        const { rows } = await pool.query(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });

        const userId  = rows[0].id;
        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000);
        await pool.query(
            `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
            [userId, token, expires]
        );

        await sendPasswordResetEmail(email.toLowerCase(), token);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
