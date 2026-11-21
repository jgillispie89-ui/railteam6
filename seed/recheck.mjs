// Soft-delete seeded "then" photos whose caption/title does not name the place (same rule as seed.mjs).
import fs from 'fs'; import pg from 'pg';
const env = fs.readFileSync('C:/Users/User/credentials/.env', 'utf8');
const pw = env.split(/\r?\n/).find(l => l.startsWith('RAILTEAM6_SUPABASE_DB_PASSWORD=')).split('=').slice(1).join('=').trim();
const db = new pg.Client({ host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'railteam6_app.icvommgyfhdioiofeftd', password: pw, ssl: { rejectUnauthorized: false } });
const GENERIC = new Set(['furnace','iron','mine','mines','mill','tunnel','bridge','depot','station','town','city','historic','district','site','state','park','national','ghost','company','coal','old','lake','mount','saint','north','south','east','west','county','village','miners']);
const kw = (n) => (n.replace(/\(.*?\)/g, '').split(/[^A-Za-z']+/).filter(w => w.length >= 4 && !GENERIC.has(w.toLowerCase())).sort((a, b) => b.length - a.length)[0] || '').toLowerCase();
await db.connect();
const { rows } = await db.query(`SELECT p.id, s.name, p.caption, p.source_url FROM photos p JOIN sites s ON s.id = p.site_id
  WHERE p.deleted_at IS NULL AND p.era = 'then' AND p.storage_path LIKE 'photos/seed-%'`);
for (const r of rows) {
  const k = kw(r.name);
  const text = (r.caption + ' ' + decodeURIComponent(r.source_url || '')).toLowerCase();
  if (!k || !text.includes(k)) { await db.query('UPDATE photos SET deleted_at = NOW() WHERE id = $1', [r.id]); console.log('removed', r.name, '|', (r.caption || '').slice(0, 70)); }
  else console.log('kept', r.name, '|', (r.caption || '').slice(0, 70));
}
await db.end();
