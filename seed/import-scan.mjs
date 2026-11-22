// General importer for the overnight "remains-only" scan files (coal camps, mine structures, abandoned places, bridges,
// depots, locks, early industry, Civil War ...). Same rules every time:
//  - rows without coordinates are skipped
//  - dedupe vs existing live pins: same scan key; same type family within 300 m; any type within 300 m sharing a
//    distinctive name word; or same family + same core name within 10 km  -> merge (John's text stays first)
//  - approximate badge when coord_quality starts with "approximate"; access -> private / danger badges + note
//  - photo_links are stored as source links (never hotlinked as photos)
//  - a type the database does not have is mapped to the nearest one and reported
// Usage: node import-scan.mjs <file.json> <keyPrefix> [--default-type t] [--dry]
import fs from 'fs'; import pg from 'pg';
const [FILE, PREFIX] = process.argv.slice(2); const DRY = process.argv.includes('--dry');
// --new "a,b": rows whose name contains one of these always become their own pin (never merged)
const newIdx = process.argv.indexOf('--new'); const NEW = newIdx > 0 ? process.argv[newIdx + 1].toLowerCase().split(',').map(s => s.trim()).filter(Boolean) : [];
const defIdx = process.argv.indexOf('--default-type'); const DEFAULT_TYPE = defIdx > 0 ? process.argv[defIdx + 1] : 'other';
const env = fs.readFileSync('C:/Users/User/credentials/.env', 'utf8');
const pw = env.split(/\r?\n/).find(l => l.startsWith('RAILTEAM6_SUPABASE_DB_PASSWORD=')).split('=').slice(1).join('=').trim();
const db = new pg.Client({ host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'railteam6_app.icvommgyfhdioiofeftd', password: pw, ssl: { rejectUnauthorized: false } });
const FAMILY = { coal_town: 'town', ghost_town: 'town', lost_town: 'town', mine: 'mine', iron_furnace: 'furnace', tunnel: 'tunnel',
  bridge: 'bridge', trestle: 'bridge', depot: 'rail_bldg', freight_house: 'rail_bldg', roundhouse: 'rail_bldg', water_tower: 'rail_bldg', coaling_tower: 'rail_bldg',
  lost_building: 'building', other: 'other', yard: 'rail', junction: 'rail', interlocking: 'rail', wreck_site: 'rail', possible_find: 'cand' };
const GENERIC = new Set(('the old of and a an at on in near co company coal camp town city mine mines no number site ruins ruin remains remnants additional ' +
  'structures structure building buildings district historic abandoned former lost tunnel bridge depot station furnace iron railroad railway rail ky ' +
  'kentucky county creek branch fork road store office').split(' '));
const core = n => n.toLowerCase().split(/[(:]|\s\/\s/)[0].replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !GENERIC.has(w)).join(' ');
const words = n => n.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !GENERIC.has(w));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const arr = v => Array.isArray(v) ? v : v ? [v] : [];
const yr = v => { const m = String(v ?? "").match(/\d{4}/); return m ? +m[0] : null; };  // "1861 (expanded 1875)" -> 1861
await db.connect();
const ENUM = new Set((await db.query(`SELECT unnest(enum_range(NULL::site_type))::text v`)).rows.map(r => r.v));
const owner = (await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const res = { added: [], merged: [], skipped: [], typeMapped: {} };
if (!DRY) await db.query('BEGIN');
for (const t of rows) {
  if (t.lat == null || t.lat === '' || !Number.isFinite(+t.lat) || !Number.isFinite(+t.lon)) { res.skipped.push(t.name); continue; }
  const lat = +t.lat, lon = +t.lon, approx = /^(approx|rough)/i.test(t.coord_quality || ''), key = PREFIX + ':' + slug(t.name);
  let type = t.type || DEFAULT_TYPE;
  if (!ENUM.has(type)) {
    const m = /bridge|trestle|viaduct/.test(type) ? 'bridge' : /depot|station/.test(type) ? 'depot' : /town|camp/.test(type) ? 'ghost_town'
      : /mine|tipple|portal/.test(type) ? 'mine' : /building|house|church|school|hospital|hotel|distillery|factory|military|theat|mill|lock|dam|fort|industry|kiln|works/.test(type) ? 'lost_building' : 'other';
    res.typeMapped[type + ' -> ' + m] = (res.typeMapped[type + ' -> ' + m] || 0) + 1; type = m;
  }
  const fam = FAMILY[type] || 'other';
  const near = (await db.query(`SELECT id, name, site_type::text t, seed_key, coords_approx, description,
      ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) d
      FROM sites WHERE deleted_at IS NULL AND site_type::text <> 'possible_find'
      AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, 10000) ORDER BY d`, [lon, lat])).rows;
  const fromThisFile = r => (r.seed_key || '').startsWith(PREFIX + ':') && r.seed_key !== key;
  const myWords = words(t.name), myCore = core(t.name);
  const sameCore = r => { const c = core(r.name); return myCore.length >= 4 && c.length >= 4 && (c === myCore || c.startsWith(myCore + ' ') || myCore.startsWith(c + ' ')); };
  const forceNew = NEW.some(s => t.name.toLowerCase().includes(s));
  const hit = forceNew ? near.find(r => r.seed_key === key) : near.find(r => r.seed_key === key)
    || near.find(r => !fromThisFile(r) && r.d <= 300 && (FAMILY[r.t] || 'other') === fam)
    || near.find(r => !fromThisFile(r) && r.d <= 300 && words(r.name).some(w => myWords.includes(w)))
    || near.find(r => !fromThisFile(r) && (FAMILY[r.t] || 'other') === fam && sameCore(r));
  const remains = arr(t.remains);
  const text = [t.company && `Company: ${t.company}.`, t.line && `Line: ${t.line}.`, t.history,
    remains.length && 'What is left:\n' + remains.map(x => '- ' + x).join('\n'), t.access && 'Access: ' + t.access].filter(Boolean).join('\n\n');
  const links = [...arr(t.sources).map(u => typeof u === 'string' ? { url: u, title: u } : { url: u.url, title: u.title || u.label || u.url }),
    ...arr(t.photo_links).map(p => ({ url: p.url, title: (p.label || 'Photo link') + (p.what ? ' (' + p.what + ')' : '') }))];
  const acc = String(t.access || '');
  const danger = /danger|collaps|unsound|caved|unstable|do not enter|hazard/i.test(acc);
  const priv = /private|occupied|people live|permission|guarded|no trespass/i.test(acc);
  const note = approx ? 'Approximate: ' + String(t.coord_quality).replace(/^(approximate:?|approx\.?|rough:?)\s*/i, '') : null;
  const county = String(t.county || '').split(/[\/(]/)[0].trim() || null;
  let siteId;
  if (hit) {
    res.merged.push(`${t.name} -> ${hit.name} [${hit.t}] (${Math.round(hit.d)} m)`); siteId = hit.id;
    if (!DRY) {
      const desc = hit.description || '';
      const probe = String(remains[0] || t.history || '').slice(0, 50);
      const add = probe && desc.includes(probe) ? desc : (desc ? desc + '\n\nScan notes: ' + text : text);
      await db.query(`UPDATE sites SET description=$2, is_dangerous = is_dangerous OR $3, is_private_land = is_private_land OR $4,
          built_year=COALESCE(built_year,$5), closed_year=COALESCE(closed_year,$6), county=COALESCE(county,$7), updated_at=now() WHERE id=$1`,
        // the danger badge only carries over to a pin of the same kind (a portal's danger should not flag a whole town)
        [hit.id, add, danger && (FAMILY[hit.t] || 'other') === fam, priv, yr(t.built_year), yr(t.closed_year) ?? yr(t.abandoned_year), county]);
      if (!approx && hit.coords_approx && hit.d <= 1500)
        await db.query(`UPDATE sites SET geom=ST_SetSRID(ST_MakePoint($2,$3),4326), coords_approx=false, coords_note=NULL WHERE id=$1`, [hit.id, lon, lat]);
    }
  } else {
    res.added.push(`${type} ${t.name}`);
    if (!DRY) siteId = (await db.query(`INSERT INTO sites (name, site_type, status, condition, geom, built_year, closed_year, county, state_province, description,
        is_private_land, is_dangerous, coords_approx, coords_note, seed_key, mod_status, submitted_by, verified, external_refs)
        VALUES ($1,$2::site_type,$16::site_status,$17,ST_SetSRID(ST_MakePoint($3,$4),4326),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'approved',$15,true,'{}') RETURNING id`,
      [t.name, type, lon, lat, yr(t.built_year), yr(t.closed_year) ?? yr(t.abandoned_year), county, t.state || 'KY', text, priv, danger, approx, note, key, owner,
       // optional condition from a prep script: preserved | standing_ruin | remains (default remains)
       ({ preserved: 'preserved', standing_ruin: 'abandoned', remains: 'ruins' })[t.condition] || 'ruins', ['preserved', 'standing_ruin', 'remains'].includes(t.condition) ? t.condition : 'remains'])).rows[0].id;
  }
  if (!DRY && siteId) {
    const have = new Set((await db.query('SELECT url FROM sources WHERE site_id=$1', [siteId])).rows.map(r => r.url));
    let i = 400;
    for (const s of links) if (s.url && !have.has(s.url)) {
      await db.query('INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,$2,$3,$4,$5)', [siteId, 'website', s.title, s.url, i++]); have.add(s.url);
    }
  }
}
if (!DRY) await db.query('COMMIT');
console.log(JSON.stringify({ added: res.added.length, merged: res.merged.length, skipped: res.skipped.length, typeMapped: res.typeMapped }));
for (const k of ['added', 'merged', 'skipped']) console.log(k.toUpperCase() + ':\n  ' + res[k].join('\n  '));
await db.end();
