// Import the KY abandoned rail tunnel scan as tunnel pins.
// Dedupe vs existing tunnels: within 300 m (an "old bore" entry prefers John's abandoned/daylighted twin over the
// active bore), or same base name within 25 km -> merge (John's text stays first). Matching "possible find"
// candidates within 300 m are promoted: their source goes onto the tunnel pin and the candidate is soft-deleted.
// Usage: node import-tunnels.mjs <ky-rail-tunnels.json> [--dry]
import fs from 'fs'; import pg from 'pg';
const FILE = process.argv[2]; const DRY = process.argv.includes('--dry');
const env = fs.readFileSync('C:/Users/User/credentials/.env', 'utf8');
const pw = env.split(/\r?\n/).find(l => l.startsWith('RAILTEAM6_SUPABASE_DB_PASSWORD=')).split('=').slice(1).join('=').trim();
const db = new pg.Client({ host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'railteam6_app.icvommgyfhdioiofeftd', password: pw, ssl: { rejectUnauthorized: false } });
const base = n => n.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\b(railroad|railway|rail|tunnel|tunnels|no|the|old|abandoned|bore|parallel)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const OLD = ['abandoned', 'daylighted_inactive', 'ruins', 'destroyed'];
const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
await db.connect();
const owner = (await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
const res = { added: [], merged: [], promoted: [], skipped: [] };
const within = `ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)`;
const distSql = `ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)`;
if (!DRY) await db.query('BEGIN');
for (const t of rows) {
  if (t.lat == null || t.lat === '' || !Number.isFinite(+t.lat)) { res.skipped.push(t.name); continue; }
  const lat = +t.lat, lon = +t.lon, approx = /^approximate/i.test(t.coord_quality || ''), key = 'kytunnel:' + slug(t.name);
  const acc = String(t.access || '') + ' ' + String(t.remains || '');
  const danger = /danger|collaps|unsound|caved|coal seam|fire|flooded|do not enter|rockfall|trespass/i.test(acc);
  const priv = /private|csx land|landowner|permission/i.test(String(t.access || ''));
  const near = (await db.query(`SELECT id, name, status::text status, seed_key, coords_approx, description, ${distSql} d
      FROM sites WHERE deleted_at IS NULL AND site_type::text = 'tunnel' AND ${within} ORDER BY d`, [lon, lat, 25000])).rows;
  const other = r => r.seed_key === key || !(r.seed_key || '').startsWith('kytunnel:');
  const close = near.filter(r => r.d <= 300 && other(r));
  const oldBore = /old bore|parallel bore/i.test(t.name);
  const b = base(t.name);
  const hit = near.find(r => r.seed_key === key)
    || (oldBore ? close.find(r => OLD.includes(r.status)) : null) || close[0]
    || near.find(r => other(r) && /[a-z]/.test(b) && base(r.name) === b);
  const text = [t.aka && `Also called ${t.aka}.`, t.line && `Line: ${t.line}.`, t.length_ft && `Length about ${t.length_ft} ft.`, t.history,
    t.remains && 'What is left: ' + t.remains, t.access && 'Access: ' + t.access].filter(Boolean).join('\n\n');
  const links = [...(t.sources || []).map(u => ({ url: u, title: u })), ...(t.photo_links || []).map(p => ({ url: p.url, title: (p.label || 'Photo link') + (p.what ? ' (' + p.what + ')' : '') }))];
  const note = approx ? 'Approximate: ' + String(t.coord_quality).replace(/^approximate:\s*/i, '') : null;
  let siteId;
  if (hit) {
    res.merged.push(`${t.name} -> ${hit.name} [${hit.status}] (${Math.round(hit.d)} m)`);
    siteId = hit.id;
    if (!DRY) {
      const desc = hit.description || '';
      const add = desc.includes((t.remains || t.history || '').slice(0, 50)) ? desc : (desc ? desc + '\n\nTunnel scan notes: ' + text : text);
      await db.query(`UPDATE sites SET description=$2, is_dangerous = is_dangerous OR $3, is_private_land = is_private_land OR $4,
          built_year=COALESCE(built_year,$5), closed_year=COALESCE(closed_year,$6), updated_at=now() WHERE id=$1`,
        [hit.id, add, danger, priv, t.built_year || null, t.abandoned_year || null]);
      if (!approx && hit.coords_approx && hit.d <= 1500) await db.query(`UPDATE sites SET geom=ST_SetSRID(ST_MakePoint($2,$3),4326), coords_approx=false, coords_note=NULL WHERE id=$1`, [hit.id, lon, lat]);
    }
  } else {
    res.added.push(t.name);
    if (!DRY) {
      const cond = /caved|collaps|sealed|blocked|buried/i.test(String(t.remains || '')) ? 'remains' : 'standing_ruin';
      siteId = (await db.query(`INSERT INTO sites (name, site_type, status, condition, geom, built_year, closed_year, county, state_province, description,
          is_private_land, is_dangerous, coords_approx, coords_note, seed_key, mod_status, submitted_by, verified, external_refs)
          VALUES ($1,'tunnel',$2::site_status,$3,ST_SetSRID(ST_MakePoint($4,$5),4326),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'approved',$16,true,'{}') RETURNING id`,
        [t.name, cond === 'remains' ? 'ruins' : 'abandoned', cond, lon, lat, t.built_year || null, t.abandoned_year || null,
         String(t.county || '').split(/[\/(]/)[0].trim() || null, t.state || 'KY', text, priv, danger, approx, note, key, owner])).rows[0].id;
    }
  }
  if (!DRY && siteId) {
    const have = new Set((await db.query('SELECT url FROM sources WHERE site_id=$1', [siteId])).rows.map(r => r.url));
    let i = 300; for (const s of links) if (s.url && !have.has(s.url)) { await db.query('INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,$2,$3,$4,$5)', [siteId, 'website', s.title, s.url, i++]); have.add(s.url); }
  }
  // promote matching possible-find candidates (tunnel-ish, within 300 m)
  const cands = (await db.query(`SELECT id, name, history_credit, ${distSql} d FROM sites WHERE deleted_at IS NULL AND site_type::text='possible_find'
      AND (external_refs->>'candidate_kind' = 'rail_tunnel' OR name ILIKE '%tunnel%') AND ${within} ORDER BY d`, [lon, lat, 300])).rows;
  for (const c of cands) {
    res.promoted.push(`${c.name} -> ${hit ? hit.name : t.name} (${Math.round(c.d)} m)`);
    if (DRY) continue;
    if (c.history_credit) await db.query(`INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,'website',$2,NULL,399)`, [siteId, 'Earlier candidate list: ' + c.history_credit]);
    await db.query(`UPDATE sites SET deleted_at=now(), mod_note=$2 WHERE id=$1`, [c.id, `promoted 2026-11-21: confirmed by the KY rail tunnel scan, merged into pin ${siteId}`]);
  }
}
if (!DRY) await db.query('COMMIT');
console.log(JSON.stringify({ added: res.added.length, merged: res.merged.length, promoted: res.promoted.length, skipped: res.skipped.length }));
for (const k of ['added', 'merged', 'promoted', 'skipped']) console.log(k.toUpperCase() + ':\n  ' + res[k].join('\n  '));
await db.end();
