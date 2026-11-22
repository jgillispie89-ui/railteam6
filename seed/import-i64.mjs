// Import the I-64 Ruins Run pins (John-approved 2026-11-21) into the live map.
// Usage: node import-i64.mjs <pins.json> [--dry]
// Dedupe: same type and (within 150 m, or same distinctive keyword within 3 km) -> merge sources/notes into the existing pin.
import fs from 'fs'; import pg from 'pg';
const FILE = process.argv[2]; const DRY = process.argv.includes('--dry');
const env = fs.readFileSync('C:/Users/User/credentials/.env', 'utf8');
const pw = env.split(/\r?\n/).find(l => l.startsWith('RAILTEAM6_SUPABASE_DB_PASSWORD=')).split('=').slice(1).join('=').trim();
const db = new pg.Client({ host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'railteam6_app.icvommgyfhdioiofeftd', password: pw, ssl: { rejectUnauthorized: false } });
const TYPE = { tunnel: 'tunnel', furnace: 'iron_furnace', mine: 'mine', depot: 'depot', bridge: 'bridge', lostbldg: 'lost_building', town: 'ghost_town', other: 'other' };
const GENERIC = new Set(['furnace','iron','mine','mines','mill','mills','tunnel','bridge','bridges','depot','station','town','city','historic','site','state','park','ghost','company','coal','old','house','ruins','church','school','tower','fire','creek','river','lock','railway','railroad','line','subdivision','tipple','marker','remains','complex','road','campus','eastern','kentucky','ohio','tunnel','sandstone','retaining','wall','passenger']);
const kws = n => n.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(' ').filter(w => w.length >= 4 && !GENERIC.has(w));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stateOf = p => /ohio/i.test(p.n) ? 'OH' : /fort gay/i.test(p.co || '') ? 'KY' : 'KY';
await db.connect();
const enumVals = (await db.query(`SELECT unnest(enum_range(NULL::site_type))::text v`)).rows.map(r => r.v);
if (!enumVals.includes('other') && !DRY) await db.query(`ALTER TYPE site_type ADD VALUE IF NOT EXISTS 'other'`);
const owner = (await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
const pins = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const res = { added: [], merged: [], skipped: [] };
for (const p of pins) {
  const type = TYPE[p.t] || 'other';
  const key = 'i64:' + slug(p.n);
  const near = (await db.query(`SELECT id, name, site_type::text t, coords_approx, description, seed_key,
      ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) d
      FROM sites WHERE deleted_at IS NULL AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, 3000)
      ORDER BY d`, [p.lon, p.lat])).rows;
  const mine = kws(p.n);
  // Pins from this same file never merge into each other; "No. 10" vs "No. 11" never merge.
  const nums = n => (n.match(/\d+/g) || []).join(',');
  const other = r => !(r.seed_key || '').startsWith('i64:');
  const hit = near.find(r => r.seed_key === key) ||
    near.find(r => other(r) && r.t === type && r.d <= 150) ||
    near.find(r => other(r) && r.t === type && kws(r.name).some(k => mine.includes(k)) && (!nums(r.name) || !nums(p.n) || nums(r.name) === nums(p.n) || /No\.? ?\d/.test(r.name) === false));
  const note = p.q === 'approx' ? 'Approximate: location from the I-64 Ruins Run research; the real spot may be some distance away.' : null;
  const priv = p.a === 'private', danger = p.a === 'danger';
  const srcs = [...(p.s || []).map(u => ({ url: u, title: u })), ...(p.ph || []).map(x => ({ url: x.url, title: (x.label || x.what || 'Photo/description') + (x.what && x.label ? ' (' + x.what + ')' : '') }))];
  if (hit) {
    res.merged.push(`${p.n} -> ${hit.name} (${Math.round(hit.d)} m)`);
    if (DRY) continue;
    const have = new Set((await db.query('SELECT url FROM sources WHERE site_id=$1', [hit.id])).rows.map(r => r.url));
    let i = 100;
    for (const s of srcs) if (s.url && !have.has(s.url)) { await db.query('INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,$2,$3,$4,$5)', [hit.id, 'website', s.title, s.url, i++]); have.add(s.url); }
    const desc = hit.description || '';
    const add = desc.includes(p.x.slice(0, 60)) ? desc : (desc ? desc + '\n\nField notes (I-64 Ruins Run): ' + p.x : p.x);
    await db.query(`UPDATE sites SET description=$2, is_private_land = is_private_land OR $3, is_dangerous = is_dangerous OR $4,
        county = COALESCE(county, NULLIF($5,'')), updated_at = now() WHERE id=$1`, [hit.id, add, priv, danger, (p.co || '').split(' (')[0]]);
    if (p.q === 'exact' && hit.coords_approx && hit.d <= 1500) await db.query(`UPDATE sites SET geom=ST_SetSRID(ST_MakePoint($2,$3),4326), coords_approx=false, coords_note=NULL WHERE id=$1`, [hit.id, p.lon, p.lat]);
    continue;
  }
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) { res.skipped.push(p.n + ' (no GPS)'); continue; }
  res.added.push(`${type} ${p.n}`);
  if (DRY) continue;
  const { rows } = await db.query(`INSERT INTO sites (name, site_type, status, condition, geom, county, state_province, description,
      is_private_land, is_dangerous, coords_approx, coords_note, seed_key, mod_status, submitted_by, verified, external_refs)
      VALUES ($1,$2::site_type,'ruins','remains',ST_SetSRID(ST_MakePoint($3,$4),4326),$5,$6,$7,$8,$9,$10,$11,$12,'approved',$13,true,'{}') RETURNING id`,
    [p.n, type, p.lon, p.lat, (p.co || '').split(' (')[0] || null, stateOf(p), p.x, priv, danger, p.q === 'approx', note, key, owner]);
  let i = 0;
  for (const s of srcs) if (s.url) await db.query('INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,$2,$3,$4,$5)', [rows[0].id, 'website', s.title, s.url, i++]);
}
console.log(JSON.stringify({ added: res.added.length, merged: res.merged.length, skipped: res.skipped.length, enumHadOther: enumVals.includes('other') }));
console.log('MERGED\n ' + res.merged.join('\n ')); console.log('SKIPPED ' + res.skipped.join('; '));
await db.end();
