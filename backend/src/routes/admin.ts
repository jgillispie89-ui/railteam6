import { Router } from 'express';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

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

export default router;
