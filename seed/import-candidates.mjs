// Import unverified candidates as "possible_find" pins (hidden by default in the app).
// Usage: node import-candidates.mjs <ky-possible-finds.json> [--dry]
// Skips a candidate when a confirmed pin of the matching real type is within 200 m, or another
// candidate of the same kind is within 25 m (duplicate rows). Idempotent by seed_key "cand:<id>".
import fs from 'fs'; import pg from 'pg';
const FILE = process.argv[2]; const DRY = process.argv.includes('--dry');
const env = fs.readFileSync('C:/Users/User/credentials/.env', 'utf8');
const pw = env.split(/\r?\n/).find(l => l.startsWith('RAILTEAM6_SUPABASE_DB_PASSWORD=')).split('=').slice(1).join('=').trim();
const db = new pg.Client({ host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'railteam6_app.icvommgyfhdioiofeftd', password: pw, ssl: { rejectUnauthorized: false } });
const REAL = { mine: ['mine', 'coal_town'], mine_portal: ['mine', 'coal_town'], rail_tunnel: ['tunnel'], other: null };
const KIND_LABEL = { mine: 'Mine', mine_portal: 'Mine portal / entry', rail_tunnel: 'Railroad tunnel', other: 'Other' };
const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
await db.connect();
const owner = (await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
const have = new Set((await db.query(`SELECT seed_key FROM sites WHERE seed_key LIKE 'cand:%'`)).rows.map(r => r.seed_key));
// candidates near a confirmed pin of the matching type
const conf = (await db.query(`SELECT site_type::text t, ST_Y(geom::geometry) lat, ST_X(geom::geometry) lon FROM sites WHERE deleted_at IS NULL AND site_type::text <> 'possible_find'`)).rows;
const dist = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const kept = [], skip = { nearConfirmed: 0, dupInFile: 0, already: 0, noGPS: 0 };
for (const c of rows) {
  const key = 'cand:' + c.id;
  if (have.has(key)) { skip.already++; continue; }
  if (!Number.isFinite(+c.lat) || !Number.isFinite(+c.lon)) { skip.noGPS++; continue; }
  const p = { lat: +c.lat, lon: +c.lon }; const real = REAL[c.kind];
  if (real && conf.some(s => real.includes(s.t) && Math.abs(s.lat - p.lat) < 0.003 && dist(s, p) <= 200)) { skip.nearConfirmed++; continue; }
  if (kept.some(k => k.kind === c.kind && Math.abs(k.lat - p.lat) < 0.0005 && dist(k, p) <= 25)) { skip.dupInFile++; continue; }
  kept.push({ ...c, lat: p.lat, lon: p.lon, key });
}
console.log(JSON.stringify({ file: rows.length, toAdd: kept.length, skip }));
if (!DRY && kept.length) {
  await db.query('BEGIN');
  for (let i = 0; i < kept.length; i += 400) {
    const b = kept.slice(i, i + 400);
    const desc = b.map(c => [`Unverified candidate (${KIND_LABEL[c.kind] || c.kind}) from ${c.source}${c.historical ? ', marked historical' : ''}. Nobody has confirmed anything remains here.`, c.notes].filter(Boolean).join('\n\n'));
    await db.query(`INSERT INTO sites (name, site_type, status, condition, geom, county, state_province, description, history_credit,
        coords_approx, seed_key, mod_status, submitted_by, verified, external_refs)
      SELECT n, 'possible_find'::site_type, 'unknown'::site_status, 'unknown', ST_SetSRID(ST_MakePoint(lo, la), 4326), co, st, d, hc,
        false, k, 'approved', $9, false, ex::jsonb
      FROM unnest($1::text[], $2::float8[], $3::float8[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $10::text[]) AS t(n, lo, la, co, st, d, hc, k, ex)`,
      [b.map(c => c.name || KIND_LABEL[c.kind]), b.map(c => c.lon), b.map(c => c.lat), b.map(c => c.county || null), b.map(c => c.state || 'KY'),
       desc, b.map(c => `Candidate list: ${c.source}${c.source_detail ? ' (' + c.source_detail + ')' : ''}`), b.map(c => c.key), owner,
       b.map(c => JSON.stringify({ candidate_kind: c.kind, candidate_source: c.source, candidate_id: c.id }))]);
    await db.query(`INSERT INTO sources (site_id, kind, citation, url, sort_order)
      SELECT s.id, 'website', $2, NULL, 0 FROM sites s WHERE s.seed_key = ANY($1) AND NOT EXISTS (SELECT 1 FROM sources x WHERE x.site_id = s.id)`.replace('$2', `'Candidate list (unverified): ' || s.history_credit`), [b.map(c => c.key)]);
  }
  await db.query('COMMIT');
  console.log('inserted', (await db.query(`SELECT count(*)::int c FROM sites WHERE seed_key LIKE 'cand:%' AND deleted_at IS NULL`)).rows[0].c);
}
await db.end();
