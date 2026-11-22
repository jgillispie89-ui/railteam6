// Import a furnace scan (ky-furnaces.json) as iron_furnace pins.
// Dedupe: an existing iron_furnace within 300 m, or the same base name within 25 km -> merge sources + notes into it.
// Usage: node import-furnaces.mjs <file> [--dry]
import fs from 'fs'; import pg from 'pg';
const FILE = process.argv[2]; const DRY = process.argv.includes('--dry');
const env = fs.readFileSync('C:/Users/User/credentials/.env', 'utf8');
const pw = env.split(/\r?\n/).find(l => l.startsWith('RAILTEAM6_SUPABASE_DB_PASSWORD=')).split('=').slice(1).join('=').trim();
const db = new pg.Client({ host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'railteam6_app.icvommgyfhdioiofeftd', password: pw, ssl: { rejectUnauthorized: false } });
const base = n => n.toLowerCase().replace(/\(.*?\)/g, '').replace(/\bmt\.?\s/g, 'mount ').replace(/\b(iron|furnace|stack|marker|ruins?|site|the|old)\b/g, '').replace(/[^a-z]+/g, ' ').trim();
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const NOTE = 'Approximate: ';
const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
await db.connect();
const owner = (await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
const res = { added: [], merged: [], skipped: [] };
for (const f of rows) {
  if (!Number.isFinite(+f.lat) || !Number.isFinite(+f.lon) || f.lat === '' || f.lat == null) { res.skipped.push(f.name + ' (no coordinates)'); continue; }
  const lat = +f.lat, lon = +f.lon, approx = /^approximate/i.test(f.coord_quality || '');
  const near = (await db.query(`SELECT id, name, coords_approx, description, built_year, closed_year,
      ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) d
      FROM sites WHERE deleted_at IS NULL AND site_type::text = 'iron_furnace'
      AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, 25000) ORDER BY d`, [lon, lat])).rows;
  const hit = near.find(r => r.d <= 300) || near.find(r => base(r.name) && base(r.name) === base(f.name));
  const text = [f.history, f.remains && 'What is left: ' + f.remains, f.access && 'Access: ' + f.access].filter(Boolean).join('\n\n');
  const links = [...(f.sources || []).map(u => ({ url: u, title: u })), ...(f.photo_links || []).map(p => ({ url: p.url, title: (p.label || 'Photo link') + (p.what ? ' (' + p.what + ')' : '') }))];
  const note = approx ? NOTE + f.coord_quality.replace(/^approximate:\s*/i, '') : null;
  if (hit) {
    res.merged.push(`${f.name} -> ${hit.name} (${Math.round(hit.d)} m)`);
    if (DRY) continue;
    const have = new Set((await db.query('SELECT url FROM sources WHERE site_id=$1', [hit.id])).rows.map(r => r.url));
    let i = 200; for (const s of links) if (s.url && !have.has(s.url)) { await db.query('INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,$2,$3,$4,$5)', [hit.id, 'website', s.title, s.url, i++]); have.add(s.url); }
    const desc = hit.description || '';
    const add = desc.includes((f.remains || f.history || '').slice(0, 50)) ? desc : (desc ? desc + '\n\nFurnace scan notes: ' + text : text);
    await db.query(`UPDATE sites SET description=$2, built_year=COALESCE(built_year,$3), closed_year=COALESCE(closed_year,$4), updated_at=now() WHERE id=$1`,
      [hit.id, add, f.built_year || null, f.closed_year || null]);
    // Better point: confirmed beats approximate; and the scan flagged Estill's old point as ~6 miles off.
    if ((!approx && hit.coords_approx) || /not used/i.test(f.coord_quality || '') && hit.coords_approx && hit.d > 1000)
      await db.query(`UPDATE sites SET geom=ST_SetSRID(ST_MakePoint($2,$3),4326), coords_approx=$4, coords_note=$5 WHERE id=$1`, [hit.id, lon, lat, approx, note]);
    continue;
  }
  res.added.push(f.name);
  if (DRY) continue;
  const cond = /\bstands?\b|standing|intact|well-preserved/i.test(f.remains || '') ? 'standing_ruin' : 'remains';
  const { rows: [r] } = await db.query(`INSERT INTO sites (name, site_type, status, condition, geom, built_year, closed_year, county, state_province, description,
      coords_approx, coords_note, seed_key, mod_status, submitted_by, verified, external_refs)
      VALUES ($1,'iron_furnace',$2::site_status,$3,ST_SetSRID(ST_MakePoint($4,$5),4326),$6,$7,$8,$9,$10,$11,$12,$13,'approved',$14,true,'{}') RETURNING id`,
    [f.name, cond === 'standing_ruin' ? 'abandoned' : 'ruins', cond, lon, lat, f.built_year || null, f.closed_year || null, f.county || null, f.state || 'KY', text, approx, note, 'kyfurnace:' + slug(f.name), owner]);
  let i = 0; for (const s of links) if (s.url) await db.query('INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,$2,$3,$4,$5)', [r.id, 'website', s.title, s.url, i++]);
}
console.log(JSON.stringify({ added: res.added.length, merged: res.merged.length, skipped: res.skipped.length }));
console.log('ADDED: ' + res.added.join('; ')); console.log('MERGED:\n ' + res.merged.join('\n ')); console.log('SKIPPED: ' + res.skipped.join('; '));
await db.end();
