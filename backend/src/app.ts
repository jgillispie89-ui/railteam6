import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db.js';
import { removeByPublicUrls, signPaths } from './storage.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import uploadRouter from './routes/upload.js';
import feedbackRouter from './routes/feedback.js';
import { requireAdmin } from './middleware/auth.js';

dotenv.config();

// =============================================================================
// RailTeam6 "lost places" API. PRIVATE (2026-11-20): every data route requires
// the owner's admin token. Only /api/health* and /api/auth/* are open.
// =============================================================================
const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use('/api/upload', express.json({ limit: '6mb' }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

// Also the daily Vercel cron target: one tiny query keeps the free Supabase
// project from being paused for inactivity (the old project was deleted that way).
app.get('/api/health/db', async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT postgis_version()');
        res.json({ ok: true, postgis: rows[0].postgis_version });
    } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
    }
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/feedback', requireAdmin, feedbackRouter);

// Everything below is owner-only.
for (const p of ['/api/sites', '/api/lines', '/api/railroads', '/api/historic-maps', '/api/stats'])
    app.use(p, requireAdmin);

const CONDITIONS = ['preserved', 'standing_ruin', 'remains', 'gone', 'unknown'];
// Legacy NOT NULL site_status, derived from the new condition field.
const STATUS_FOR: Record<string, string> = {
    preserved: 'preserved', standing_ruin: 'abandoned', remains: 'ruins', gone: 'destroyed', unknown: 'unknown',
};

const int = (v: any) => {
    if (v === '' || v == null) return null;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
};
const txt = (v: any, max = 20000) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, max) : null;
};
const bool = (v: any) => v === true || v === 'true' || v === 1 || v === 'on';
const isHttp = (u: any) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

// =============================================================================
// GET /api/sites — all live pins as GeoJSON (lean properties for the map)
// =============================================================================
app.get('/api/sites', async (req, res) => {
    try {
        const conditions: string[] = ["s.mod_status = 'approved'", 's.deleted_at IS NULL'];
        const params: any[] = [];
        if (typeof req.query.types === 'string' && req.query.types) {
            params.push(req.query.types.split(','));
            conditions.push(`s.site_type::text = ANY($${params.length})`);
        }
        const { rows } = await pool.query(`
            SELECT s.id, s.name, s.site_type, s.condition, s.status, s.city, s.county, s.state_province,
                   s.built_year, s.closed_year, s.coords_approx,
                   ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat,
                   (SELECT COUNT(*)::int FROM photos p WHERE p.site_id = s.id AND p.deleted_at IS NULL AND p.storage_path IS NOT NULL) AS photo_count
            FROM sites s
            WHERE ${conditions.join(' AND ')}
            LIMIT 20000`, params);
        res.json({
            type: 'FeatureCollection',
            features: rows.map(r => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
                properties: {
                    id: r.id, name: r.name, site_type: r.site_type,
                    condition: r.condition || null, status: r.status,
                    city: r.city, county: r.county, state: r.state_province,
                    built_year: r.built_year, closed_year: r.closed_year,
                    approx: r.coords_approx, photos: r.photo_count,
                },
            })),
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// GET /api/sites/:id — full pin page data, photos with signed URLs
// =============================================================================
async function loadSite(id: string) {
    const { rows } = await pool.query(
        `SELECT s.*, ST_X(s.geom) AS lng, ST_Y(s.geom) AS lat FROM sites s
         WHERE s.id = $1 AND s.deleted_at IS NULL`, [id]);
    if (!rows.length) return null;
    const site = rows[0];
    delete site.geom;
    const [{ rows: photos }, { rows: sources }, { rows: railroads }] = await Promise.all([
        pool.query(`SELECT id, era, storage_path, thumb_path, url, thumbnail_url, caption, taken_year,
                           credit, photographer, license, source_url, is_historic, sort_order, width, height
                    FROM photos WHERE site_id = $1 AND deleted_at IS NULL
                    ORDER BY sort_order, taken_year NULLS LAST, created_at`, [id]),
        pool.query(`SELECT id, kind, citation, url FROM sources WHERE site_id = $1 ORDER BY sort_order, created_at`, [id]),
        pool.query(`SELECT r.name FROM railroads r JOIN site_railroads sr ON sr.railroad_id = r.id WHERE sr.site_id = $1`, [id]),
    ]);
    const signed = await signPaths(photos.flatMap((p: any) => [p.storage_path, p.thumb_path]));
    site.photos = photos
        .map((p: any) => ({
            id: p.id,
            era: p.era || (p.is_historic ? 'then' : 'now'),
            url: p.storage_path ? signed[p.storage_path] : p.url,
            thumb_url: p.thumb_path ? signed[p.thumb_path] : (p.thumbnail_url || p.url),
            caption: p.caption, year: p.taken_year, credit: p.credit || p.photographer,
            license: p.license, source_url: p.source_url, width: p.width, height: p.height,
        }))
        .filter((p: any) => p.url && !/r2\.dev/.test(p.url)); // old R2 bucket is gone
    site.sources = sources;
    site.railroads = railroads.map((r: any) => r.name);
    return site;
}

app.get('/api/sites/:id', async (req, res) => {
    try {
        const site = await loadSite(req.params.id);
        if (!site) return res.status(404).json({ error: 'Not found' });
        res.json(site);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// Shared writers for photos + sources
// =============================================================================
async function insertPhotos(siteId: string, photos: any[], userId: string) {
    if (!Array.isArray(photos)) return;
    const { rows } = await pool.query(
        `SELECT COALESCE(MAX(sort_order), -1) AS mx FROM photos WHERE site_id = $1`, [siteId]);
    let order = (rows[0]?.mx ?? -1) + 1;
    for (const p of photos) {
        if (typeof p?.storage_path !== 'string' || !p.storage_path.startsWith('photos/')) continue;
        const era = p.era === 'then' ? 'then' : 'now';
        await pool.query(
            `INSERT INTO photos (site_id, era, storage_path, thumb_path, caption, taken_year, credit,
                                 license, source_url, is_historic, uploaded_by, sort_order, width, height, bytes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [siteId, era, p.storage_path, txt(p.thumb_path, 300), txt(p.caption, 1000), int(p.year),
             txt(p.credit, 300), txt(p.license, 200), isHttp(p.source_url) ? p.source_url.trim() : null,
             era === 'then', userId, order++, int(p.width), int(p.height), int(p.bytes)]);
    }
}

async function replaceSources(siteId: string, sources: any) {
    if (!Array.isArray(sources)) return;
    await pool.query(`DELETE FROM sources WHERE site_id = $1`, [siteId]);
    let i = 0;
    for (const s of sources) {
        const citation = txt(s?.citation ?? s?.title, 1000);
        const url = isHttp(s?.url) ? s.url.trim() : null;
        if (!citation && !url) continue;
        await pool.query(
            `INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,$2,$3,$4,$5)`,
            [siteId, txt(s?.kind, 50) || 'website', citation || url, url, i++]);
    }
}

function pinFields(b: any) {
    const condition = CONDITIONS.includes(b.condition) ? b.condition : 'unknown';
    return {
        name: txt(b.name, 300), site_type: txt(b.site_type, 50), condition,
        status: STATUS_FOR[condition],
        built_year: int(b.built_year), closed_year: int(b.closed_year), demolished_year: int(b.demolished_year),
        city: txt(b.city, 200), county: txt(b.county, 200), state_province: txt(b.state, 50) || txt(b.state_province, 50),
        description: txt(b.description ?? b.history, 50000),
        is_private_land: bool(b.is_private_land), is_dangerous: bool(b.is_dangerous),
        coords_approx: bool(b.coords_approx), coords_note: txt(b.coords_note, 1000),
    };
}

// =============================================================================
// POST /api/sites — drop a new pin
// =============================================================================
app.post('/api/sites', async (req, res) => {
    try {
        const user = (req as any).user;
        const f = pinFields(req.body || {});
        const lng = Number(req.body?.lng), lat = Number(req.body?.lat);
        if (!f.name || !f.site_type || !Number.isFinite(lng) || !Number.isFinite(lat))
            return res.status(400).json({ error: 'name, type and a map location are required' });
        const { rows } = await pool.query(
            `INSERT INTO sites (name, site_type, status, condition, geom, built_year, closed_year, demolished_year,
                                city, county, state_province, description, is_private_land, is_dangerous,
                                coords_approx, coords_note, mod_status, submitted_by, verified)
             VALUES ($1,$2::site_type,$3::site_status,$4, ST_SetSRID(ST_MakePoint($5,$6),4326), $7,$8,$9,
                     $10,$11,$12,$13,$14,$15,$16,$17,'approved',$18,true)
             RETURNING id`,
            [f.name, f.site_type, f.status, f.condition, lng, lat, f.built_year, f.closed_year, f.demolished_year,
             f.city, f.county, f.state_province, f.description, f.is_private_land, f.is_dangerous,
             f.coords_approx, f.coords_note, user.id]);
        const id = rows[0].id;
        await insertPhotos(id, req.body.photos, user.id);
        await replaceSources(id, req.body.sources);
        res.status(201).json(await loadSite(id));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// PATCH /api/sites/:id — edit a pin (fields, location, add/remove photos, sources)
// =============================================================================
app.patch('/api/sites/:id', async (req, res) => {
    try {
        const user = (req as any).user;
        const b = req.body || {};
        const f = pinFields(b);
        if (!f.name || !f.site_type) return res.status(400).json({ error: 'name and type are required' });
        const lng = Number(b.lng), lat = Number(b.lat);
        const hasCoords = b.lng != null && b.lat != null && Number.isFinite(lng) && Number.isFinite(lat);
        const params: any[] = [f.name, f.site_type, f.status, f.condition, f.built_year, f.closed_year,
            f.demolished_year, f.city, f.county, f.state_province, f.description, f.is_private_land,
            f.is_dangerous, f.coords_approx, f.coords_note, req.params.id];
        if (hasCoords) params.push(lng, lat);
        const { rowCount } = await pool.query(
            `UPDATE sites SET name=$1, site_type=$2::site_type, status=$3::site_status, condition=$4,
                built_year=$5, closed_year=$6, demolished_year=$7, city=$8, county=$9, state_province=$10,
                description=$11, is_private_land=$12, is_dangerous=$13, coords_approx=$14, coords_note=$15,
                updated_at=NOW() ${hasCoords ? ', geom=ST_SetSRID(ST_MakePoint($17,$18),4326)' : ''}
             WHERE id=$16 AND deleted_at IS NULL`, params);
        if (!rowCount) return res.status(404).json({ error: 'Not found' });
        if (Array.isArray(b.remove_photo_ids) && b.remove_photo_ids.length)
            await pool.query(`UPDATE photos SET deleted_at = NOW() WHERE site_id = $1 AND id = ANY($2::uuid[])`,
                [req.params.id, b.remove_photo_ids.filter((x: any) => typeof x === 'string')]);
        await insertPhotos(req.params.id, b.photos, user.id);
        await replaceSources(req.params.id, b.sources);
        res.json(await loadSite(req.params.id));
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/sites/:id — SOFT delete (row and photos stay in the database)
app.delete('/api/sites/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE sites SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// DELETE /api/sites/:siteId/photos/:photoId — soft delete one photo
app.delete('/api/sites/:siteId/photos/:photoId', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE photos SET deleted_at = NOW() WHERE id = $1 AND site_id = $2 AND deleted_at IS NULL RETURNING id`,
            [req.params.photoId, req.params.siteId]);
        if (rows.length) return res.json({ ok: true });
        // legacy site_photos table (old public bucket)
        const { rows: legacy } = await pool.query(
            `DELETE FROM site_photos WHERE id::text = $1 AND site_id = $2 RETURNING url, thumb_url`,
            [req.params.photoId, req.params.siteId]);
        if (!legacy.length) return res.status(404).json({ error: 'Photo not found' });
        await removeByPublicUrls([legacy[0].url, legacy[0].thumb_url].filter(Boolean)).catch(() => {});
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// GET /api/stats — pin counts by type
app.get('/api/stats', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT site_type, COUNT(*)::int AS n FROM sites
             WHERE deleted_at IS NULL AND mod_status = 'approved' GROUP BY 1 ORDER BY 2 DESC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// Railroad lines / railroads / historic maps (owner-only, read)
// =============================================================================
app.get('/api/lines', async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT l.id, l.name, l.status, l.built_year, l.abandoned_year, l.removed_year,
                   r.name AS railroad_name, ST_AsGeoJSON(l.geom)::json AS geometry
            FROM lines l LEFT JOIN railroads r ON r.id = l.railroad_id LIMIT 5000`);
        res.json({
            type: 'FeatureCollection',
            features: rows.map(r => ({
                type: 'Feature', geometry: r.geometry,
                properties: { id: r.id, name: r.name, status: r.status, built_year: r.built_year,
                    abandoned_year: r.abandoned_year, removed_year: r.removed_year, railroad: r.railroad_name },
            })),
        });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

app.get('/api/railroads', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, name, abbreviation, founded_year, dissolved_year, country FROM railroads ORDER BY name`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

app.get('/api/historic-maps', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, title, publisher, published_year, tile_url, thumbnail_url, source, license, bounds
             FROM historic_maps ORDER BY published_year`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

export default app;
