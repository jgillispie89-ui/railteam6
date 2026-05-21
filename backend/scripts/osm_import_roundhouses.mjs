#!/usr/bin/env node
// Bulk-import osm_roundhouses.json entries into the Neon `sites` table.
// All rows go in as mod_status='pending'. Re-running skips entries whose
// (osm_type, osm_id) already exist in external_refs.
//
// Requires: DATABASE_URL env var. Run from anywhere — paths resolve from script location.
//   node backend/scripts/osm_import_roundhouses.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const SOURCE_TAG = 'OpenStreetMap';
const SYSTEM_USER_EMAIL = 'osm_import@railteam6.com';
const SYSTEM_USER_DISPLAY_NAME = 'OSM Import (system)';
const SITE_TYPE_ENUM = 'roundhouse';      // ENUM identifier; display label is "Roundhouses & Turntables"
const SITE_STATUS_ENUM = 'unknown';        // task requires status='pending' but site_status has no such value; mod_status carries 'pending'
const MOD_STATUS = 'pending';

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('[import] DATABASE_URL is not set.');
        console.error('[import] Set it (e.g. via .env in repo root) and retry.');
        process.exit(2);
    }

    const jsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'osm_roundhouses.json');
    const raw = await readFile(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    const entries = data.entries || [];
    console.log(`[import] Loaded ${entries.length} entries from ${jsonPath}`);

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
        max: 3,
    });

    const client = await pool.connect();
    const stats = { skipped_existing: 0, inserted: 0, errors: [] };

    try {
        // 1. Ensure 'osm_import' system user exists. The users table requires email.
        //    display_name was added in a later migration; insert into both if available.
        const { rows: existingUserRows } = await client.query(
            'SELECT id FROM users WHERE email = $1', [SYSTEM_USER_EMAIL]
        );
        let systemUserId;
        if (existingUserRows.length) {
            systemUserId = existingUserRows[0].id;
            console.log(`[import] System user already exists: ${SYSTEM_USER_EMAIL} (${systemUserId})`);
        } else {
            const { rows } = await client.query(
                `INSERT INTO users (email, display_name, role, verified)
                 VALUES ($1, $2, 'contributor', true)
                 RETURNING id`,
                [SYSTEM_USER_EMAIL, SYSTEM_USER_DISPLAY_NAME]
            );
            systemUserId = rows[0].id;
            console.log(`[import] Created system user ${SYSTEM_USER_EMAIL} (${systemUserId})`);
        }

        // 2. Pre-fetch which (osm_type, osm_id) pairs already exist so we can skip them.
        const { rows: existingRefs } = await client.query(
            `SELECT external_refs->>'osm_type' AS osm_type, external_refs->>'osm_id' AS osm_id
             FROM sites
             WHERE external_refs->>'source' = $1
               AND external_refs ? 'osm_id'`,
            [SOURCE_TAG]
        );
        const existingKey = new Set(existingRefs.map((r) => `${r.osm_type}/${r.osm_id}`));
        console.log(`[import] Found ${existingKey.size} existing OSM-sourced sites; those will be skipped.`);

        // 3. Insert in a single transaction.
        await client.query('BEGIN');

        for (const entry of entries) {
            const key = `${entry.osm_type}/${entry.osm_id}`;
            if (existingKey.has(key)) {
                stats.skipped_existing++;
                continue;
            }
            const external_refs = {
                source: SOURCE_TAG,
                osm_type: entry.osm_type,
                osm_id: entry.osm_id,
                railway_tag: entry.railway_tag,
            };
            const description = `Imported from OpenStreetMap (${entry.osm_type}/${entry.osm_id}, railway=${entry.railway_tag}). Needs human review for status, build year, railroad attribution, and photos.`;
            try {
                await client.query(
                    `INSERT INTO sites
                       (name, site_type, status, geom, state_province, address, description,
                        external_refs, mod_status, submitted_by)
                     VALUES
                       ($1, $2::site_type, $3::site_status,
                        ST_SetSRID(ST_MakePoint($4, $5), 4326),
                        $6, $7, $8, $9::jsonb, $10, $11)`,
                    [
                        entry.name,
                        SITE_TYPE_ENUM,
                        SITE_STATUS_ENUM,
                        entry.lon,
                        entry.lat,
                        entry.state,
                        entry.address,
                        description,
                        JSON.stringify(external_refs),
                        MOD_STATUS,
                        systemUserId,
                    ]
                );
                stats.inserted++;
            } catch (err) {
                stats.errors.push({ key, name: entry.name, message: err.message });
            }
        }

        await client.query('COMMIT');

        // 4. Safety verification: confirm none of the just-imported rows are live.
        const { rows: liveCheck } = await client.query(
            `SELECT COUNT(*)::int AS n
             FROM sites
             WHERE external_refs->>'source' = $1
               AND mod_status <> 'pending'`,
            [SOURCE_TAG]
        );
        const liveCount = liveCheck[0].n;

        console.log('');
        console.log('================== IMPORT REPORT ==================');
        console.log(`Source file:               ${jsonPath}`);
        console.log(`Raw from Overpass:         ${data.counts?.raw ?? 'unknown'}`);
        console.log(`Removed (no coords):       ${data.counts?.removed_no_coords ?? 0}`);
        console.log(`Removed (out of bbox):     ${data.counts?.removed_out_of_bbox ?? 0}`);
        console.log(`Removed (50m dedupe):      ${data.counts?.removed_dedup ?? 0}`);
        console.log(`Eligible for import:       ${entries.length}`);
        console.log(`Skipped (already in DB):   ${stats.skipped_existing}`);
        console.log(`Newly inserted as pending: ${stats.inserted}`);
        console.log(`Insert errors:             ${stats.errors.length}`);
        if (stats.errors.length) {
            console.log('First few errors:');
            for (const e of stats.errors.slice(0, 5)) console.log(`  - ${e.key} (${e.name}): ${e.message}`);
        }
        console.log(`Sanity check: OSM-sourced rows NOT pending = ${liveCount}`);
        if (liveCount > 0) {
            console.log('  !! WARNING: some OSM-sourced rows are not pending. Investigate before proceeding.');
        } else {
            console.log('  Confirmed: 100% of OSM-sourced rows are mod_status=pending.');
        }
        console.log('===================================================');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error('[import] FAILED:', err);
    process.exit(1);
});
