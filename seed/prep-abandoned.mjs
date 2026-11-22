// Prepare ky-abandoned.json for import-scan.mjs:
//  - types not in the database: school/hospital/church/hotel/factory/distillery/house/military -> lost_building;
//    "other" rows refined by name (depot -> depot, bridge/viaduct -> bridge, theater/store/YMCA/printers -> lost_building)
//  - a visible "Last confirmed standing: <year>" line from the newest year in the remains evidence,
//    with "(check before visiting)" when that year is before 2018 or no year is given.
// Usage: node prep-abandoned.mjs <in.json> <out.json>
import fs from 'fs';
const [IN, OUT] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const BUILDING = new Set(['school', 'hospital', 'church', 'hotel', 'factory', 'distillery', 'house', 'military']);
const stats = { types: {}, check: 0, noYear: 0 };
for (const r of rows) {
  let t = r.type;
  if (BUILDING.has(t)) t = 'lost_building';
  else if (t === 'other') {
    if (/\bdepot\b/i.test(r.name)) t = 'depot';
    else if (/bridge|viaduct/i.test(r.name)) t = 'bridge';
    else if (/saltpet|saltpeter|cave/i.test(r.name)) t = 'other';
    else if (/\btheat|store|ymca|printer|building|hall|mill/i.test(r.name)) t = 'lost_building';
  }
  stats.types[r.type + ' -> ' + t] = (stats.types[r.type + ' -> ' + t] || 0) + 1;
  r.type = t;
  const ev = Array.isArray(r.remains) ? r.remains.join(' ') : String(r.remains || '');
  const years = (ev.match(/\b(19[5-9]\d|20[0-2]\d)\b/g) || []).map(Number).filter(y => y <= 2026);
  const y = years.length ? Math.max(...years) : null;
  const line = y ? `Last confirmed standing: ${y}${y < 2018 ? ' (check before visiting)' : ''}` : 'Last confirmed standing: date of evidence not given (check before visiting)';
  if (!y) stats.noYear++; if (!y || y < 2018) stats.check++;
  r.remains = [line, ...(Array.isArray(r.remains) ? r.remains : r.remains ? [r.remains] : [])];
  if (r.notes) r.history = [r.history, 'Note: ' + r.notes].filter(Boolean).join('\n\n');
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(JSON.stringify(stats));
