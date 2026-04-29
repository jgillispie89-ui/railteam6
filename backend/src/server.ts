import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import uploadRouter from './routes/upload.js';
import { requireAuth } from './middleware/auth.js';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// =============================================================================
// DB migration — runs once on startup, idempotent
// See db/migrations/2026-04-23-add-auth-columns.sql for the canonical SQL.
// =============================================================================
async function migrate() {
    // Fresh installs: create users table with UUID primary key
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email                           VARCHAR(255) UNIQUE NOT NULL,
            password_hash                   TEXT,
            role                            VARCHAR(20) NOT NULL DEFAULT 'contributor',
            verified                        BOOLEAN NOT NULL DEFAULT false,
            verification_token              TEXT,
            verification_token_expires_at   TIMESTAMPTZ,
            created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Existing installs: add any missing columns without touching existing data
    await pool.query(`
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS password_hash                  TEXT,
            ADD COLUMN IF NOT EXISTS role                           VARCHAR(20) NOT NULL DEFAULT 'contributor',
            ADD COLUMN IF NOT EXISTS verified                       BOOLEAN     NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS verification_token             TEXT,
            ADD COLUMN IF NOT EXISTS verification_token_expires_at  TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await pool.query(`
        ALTER TABLE sites
            ADD COLUMN IF NOT EXISTS mod_status   VARCHAR(20) NOT NULL DEFAULT 'approved',
            ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id),
            ADD COLUMN IF NOT EXISTS mod_note     TEXT,
            ADD COLUMN IF NOT EXISTS photo_url    TEXT,
            ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ
    `);

    await pool.query(`ALTER TYPE site_status ADD VALUE IF NOT EXISTS 'daylighted'`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS site_photos (
            id         SERIAL PRIMARY KEY,
            site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
            url        TEXT NOT NULL,
            thumb_url  TEXT,
            sort_order INT  NOT NULL DEFAULT 0
        )
    `);
}

// =============================================================================
// Routes
// =============================================================================
app.use('/api/auth',   authRouter);
app.use('/api/admin',  adminRouter);
app.use('/api/upload', uploadRouter);

app.get('/api/health', async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT postgis_version()');
        res.json({ ok: true, postgis: rows[0].postgis_version });
    } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
    }
});

// =============================================================================
// GET /api/sites — public; only approved sites visible
// =============================================================================
app.get('/api/sites', async (req, res) => {
    try {
        const conditions: string[] = ["s.mod_status = 'approved'"];
        const params: any[] = [];
        let idx = 1;

        if (typeof req.query.bbox === 'string') {
            const parts = req.query.bbox.split(',').map(Number);
            if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
                const [minLng, minLat, maxLng, maxLat] = parts;
                conditions.push(`s.geom && ST_MakeEnvelope($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, 4326)`);
                params.push(minLng, minLat, maxLng, maxLat);
                idx += 4;
            }
        }
        if (typeof req.query.types === 'string') {
            const types = req.query.types.split(',');
            conditions.push(`s.site_type = ANY($${idx}::site_type[])`);
            params.push(types); idx++;
        }
        if (typeof req.query.statuses === 'string') {
            const statuses = req.query.statuses.split(',');
            conditions.push(`s.status = ANY($${idx}::site_status[])`);
            params.push(statuses); idx++;
        }
        if (typeof req.query.year === 'string') {
            const year = parseInt(req.query.year, 10);
            if (Number.isFinite(year)) {
                conditions.push(`s.built_year <= $${idx}`);
                conditions.push(`(s.demolished_year IS NULL OR s.demolished_year > $${idx})`);
                params.push(year); idx++;
            }
        }
        if (typeof req.query.railroad === 'string') {
            conditions.push(`EXISTS (
                SELECT 1 FROM site_railroads sr
                JOIN railroads r ON r.id = sr.railroad_id
                WHERE sr.site_id = s.id
                AND (r.name ILIKE $${idx} OR r.abbreviation ILIKE $${idx})
            )`);
            params.push(`%${req.query.railroad}%`); idx++;
        }

        const sql = `
            SELECT s.id, s.name, s.site_type, s.status,
                   s.built_year, s.closed_year, s.demolished_year,
                   s.city, s.state_province, s.country, s.description, s.photo_url,
                   s.submitted_by,
                   ST_AsGeoJSON(s.geom)::json AS geometry,
                   COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS railroads
            FROM sites s
            LEFT JOIN site_railroads sr ON sr.site_id = s.id
            LEFT JOIN railroads r ON r.id = sr.railroad_id
            WHERE ${conditions.join(' AND ')}
            GROUP BY s.id
            LIMIT 5000
        `;
        const { rows } = await pool.query(sql, params);
        res.json({
            type: 'FeatureCollection',
            features: rows.map(r => ({
                type: 'Feature', geometry: r.geometry,
                properties: {
                    id: r.id, name: r.name, site_type: r.site_type, status: r.status,
                    built_year: r.built_year, closed_year: r.closed_year,
                    demolished_year: r.demolished_year, city: r.city,
                    state: r.state_province, country: r.country,
                    description: r.description, railroads: r.railroads,
                    photo_url: r.photo_url, submitted_by: r.submitted_by,
                },
            })),
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// GET /api/sites/:id
// =============================================================================
app.get('/api/sites/:id', async (req, res) => {
    try {
        const { rows: siteRows } = await pool.query(
            `SELECT s.*, ST_AsGeoJSON(s.geom)::json AS geometry FROM sites s WHERE s.id = $1`,
            [req.params.id]
        );
        if (!siteRows.length) return res.status(404).json({ error: 'Not found' });
        const site = siteRows[0];
        const { rows: railroads } = await pool.query(
            `SELECT r.* FROM railroads r JOIN site_railroads sr ON sr.railroad_id = r.id WHERE sr.site_id = $1`,
            [req.params.id]
        );
        const { rows: photos } = await pool.query(
            `SELECT * FROM photos WHERE site_id = $1 ORDER BY taken_year NULLS LAST`, [req.params.id]
        );
        const { rows: sitePhotos } = await pool.query(
            `SELECT url, thumb_url, sort_order FROM site_photos WHERE site_id = $1 ORDER BY sort_order`,
            [req.params.id]
        );
        const { rows: sources } = await pool.query(
            `SELECT * FROM sources WHERE site_id = $1`, [req.params.id]
        );
        res.json({ ...site, railroads, photos, site_photos: sitePhotos, sources });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// GET /api/lines
// =============================================================================
app.get('/api/lines', async (req, res) => {
    try {
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (typeof req.query.bbox === 'string') {
            const parts = req.query.bbox.split(',').map(Number);
            if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
                conditions.push(`l.geom && ST_MakeEnvelope($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, 4326)`);
                params.push(...parts); idx += 4;
            }
        }
        if (typeof req.query.statuses === 'string') {
            conditions.push(`l.status = ANY($${idx}::line_status[])`);
            params.push(req.query.statuses.split(',')); idx++;
        }
        if (typeof req.query.year === 'string') {
            const year = parseInt(req.query.year, 10);
            if (Number.isFinite(year)) {
                conditions.push(`l.built_year <= $${idx}`);
                conditions.push(`(l.removed_year IS NULL OR l.removed_year > $${idx})`);
                params.push(year); idx++;
            }
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const { rows } = await pool.query(`
            SELECT l.id, l.name, l.status, l.built_year, l.abandoned_year, l.removed_year,
                   r.name AS railroad_name, r.abbreviation AS railroad_abbr,
                   ST_AsGeoJSON(l.geom)::json AS geometry
            FROM lines l LEFT JOIN railroads r ON r.id = l.railroad_id
            ${where} LIMIT 2000
        `, params);

        res.json({
            type: 'FeatureCollection',
            features: rows.map(r => ({
                type: 'Feature', geometry: r.geometry,
                properties: {
                    id: r.id, name: r.name, status: r.status,
                    built_year: r.built_year, abandoned_year: r.abandoned_year,
                    removed_year: r.removed_year,
                    railroad: r.railroad_name, railroad_abbr: r.railroad_abbr,
                },
            })),
        });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// GET /api/railroads
// =============================================================================
app.get('/api/railroads', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, name, abbreviation, founded_year, dissolved_year, country FROM railroads ORDER BY name`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// GET /api/historic-maps
// =============================================================================
app.get('/api/historic-maps', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, title, publisher, published_year, tile_url, thumbnail_url, source, license FROM historic_maps ORDER BY published_year`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// POST /api/historic-maps — requires auth
// =============================================================================
app.post('/api/historic-maps', requireAuth, async (req, res) => {
    try {
        const { title, publisher, published_year, tile_url, thumbnail_url, source, source_url, license } = req.body;
        if (!title || !published_year || !tile_url)
            return res.status(400).json({ error: 'title, published_year, and tile_url are required' });
        const { rows } = await pool.query(
            `INSERT INTO historic_maps (title, publisher, published_year, tile_url, thumbnail_url, source, source_url, license, bbox)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_GeomFromText('POLYGON((-180 -90, 180 -90, 180 90, -180 90, -180 -90))', 4326))
             RETURNING id, title, published_year, tile_url`,
            [title, publisher || null, published_year, tile_url, thumbnail_url || null, source || null, source_url || null, license || 'public domain']
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// POST /api/lines — requires auth
// =============================================================================
app.post('/api/lines', requireAuth, async (req, res) => {
    try {
        const { name, railroad_id, status, built_year, abandoned_year, removed_year, description, coordinates } = req.body;
        if (!status || !coordinates || coordinates.length < 2)
            return res.status(400).json({ error: 'status and coordinates (2+ points) are required' });
        const wkt = `LINESTRING(${coordinates.map((c: number[]) => `${c[0]} ${c[1]}`).join(', ')})`;
        const { rows } = await pool.query(
            `INSERT INTO lines (name, railroad_id, status, built_year, abandoned_year, removed_year, description, geom)
             VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeomFromText($8, 4326)) RETURNING id, name, status`,
            [name || null, railroad_id || null, status, built_year || null, abandoned_year || null, removed_year || null, description || null, wkt]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// POST /api/sites — requires verified auth
// trusted/admin → live immediately; contributor → pending queue
// =============================================================================
app.post('/api/sites', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        if (!user.verified)
            return res.status(403).json({ error: 'Verify your email before submitting sites' });

        const { name, site_type, status, lng, lat, built_year, closed_year, demolished_year, city, state_province, description, photo_url, photos } = req.body;
        if (!name || !site_type || !status || lng == null || lat == null)
            return res.status(400).json({ error: 'name, site_type, status, lng, lat are required' });

        // Normalise to a list of {url, thumb_url} — support both the new photos[] array and the legacy single photo_url
        const photoList: { url: string; thumb_url?: string }[] =
            Array.isArray(photos) && photos.length > 0
                ? photos.filter((p: any) => typeof p?.url === 'string')
                : photo_url ? [{ url: photo_url }] : [];
        const primaryPhotoUrl = photoList[0]?.url || null;

        const mod_status = (user.role === 'admin' || user.role === 'trusted') ? 'approved' : 'pending';
        const { rows } = await pool.query(
            `INSERT INTO sites (name, site_type, status, geom, built_year, closed_year, demolished_year,
                                city, state_province, description, photo_url, mod_status, submitted_by)
             VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id, name, site_type, status, mod_status`,
            [name, site_type, status, lng, lat, built_year || null, closed_year || null,
             demolished_year || null, city || null, state_province || null, description || null,
             primaryPhotoUrl, mod_status, user.id]
        );

        if (photoList.length > 0) {
            await Promise.all(photoList.map((p, i) =>
                pool.query(
                    `INSERT INTO site_photos (site_id, url, thumb_url, sort_order) VALUES ($1, $2, $3, $4)`,
                    [rows[0].id, p.url, p.thumb_url || null, i]
                )
            ));
        }

        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// PATCH /api/sites/:id — admin or original submitter only; goes live immediately
// =============================================================================
app.patch('/api/sites/:id', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        const { rows: existing } = await pool.query(
            `SELECT submitted_by FROM sites WHERE id = $1`, [req.params.id]
        );
        if (!existing.length) return res.status(404).json({ error: 'Not found' });
        if (user.role !== 'admin' && existing[0].submitted_by !== user.id)
            return res.status(403).json({ error: 'Not authorized to edit this site' });

        const { name, site_type, status, lng, lat, built_year, closed_year, demolished_year, city, state_province, description, photos } = req.body;
        if (!name || !site_type || !status)
            return res.status(400).json({ error: 'name, site_type, and status are required' });

        const hasCoords = lng != null && lat != null && Number.isFinite(+lng) && Number.isFinite(+lat);
        const params: any[] = [
            name, site_type, status,
            built_year || null, closed_year || null, demolished_year || null,
            city || null, state_province || null, description || null,
        ];
        if (hasCoords) { params.push(+lng, +lat); }
        params.push(req.params.id);
        const idIdx = params.length;

        const { rows } = await pool.query(
            `UPDATE sites SET
                name=$1, site_type=$2, status=$3,
                built_year=$4, closed_year=$5, demolished_year=$6,
                city=$7, state_province=$8, description=$9,
                updated_at=NOW()
                ${hasCoords ? `, geom=ST_SetSRID(ST_MakePoint($10,$11),4326)` : ''}
             WHERE id=$${idIdx}
             RETURNING id, name, site_type, status, built_year, closed_year, demolished_year,
                       city, state_province, description, updated_at`,
            params
        );

        if (Array.isArray(photos) && photos.length > 0) {
            const { rows: ex } = await pool.query(
                `SELECT COALESCE(MAX(sort_order), -1) AS mx FROM site_photos WHERE site_id=$1`,
                [req.params.id]
            );
            const start = (ex[0]?.mx ?? -1) + 1;
            await Promise.all(
                photos.filter((p: any) => typeof p?.url === 'string').map((p: any, i: number) =>
                    pool.query(
                        `INSERT INTO site_photos (site_id, url, thumb_url, sort_order) VALUES ($1,$2,$3,$4)`,
                        [req.params.id, p.url, p.thumb_url || null, start + i]
                    )
                )
            );
        }

        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// DELETE /api/sites/:id — admin or original submitter only
// =============================================================================
app.delete('/api/sites/:id', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        const { rows } = await pool.query(
            `DELETE FROM sites WHERE id = $1 AND (submitted_by = $2 OR $3 = true) RETURNING id`,
            [req.params.id, user.id, user.role === 'admin']
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found or not authorized' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// Boot
// =============================================================================
const port = parseInt(process.env.PORT || '3001', 10);
migrate()
    .then(() => app.listen(port, () => console.log(`Iron Roads API listening on http://localhost:${port}`)))
    .catch(err => { console.error('Migration failed:', err); process.exit(1); });
