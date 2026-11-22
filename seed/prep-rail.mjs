// Prepare ky-rail-bridges-depots.json for import-scan.mjs.
//  - types: bridge -> bridge, trestle -> trestle, depot -> depot; tower -> coaling_tower / interlocking (yard tower);
//    rail_structure -> roundhouse when it is one, else other
//  - "~2002 rule": when the location is a town center, or the only condition evidence is the c.2002 KYTC survey,
//    the pin says "Last confirmed standing: ~2002 (check before visiting)" and gets the approximate badge
//  - otherwise "Last confirmed standing: <newest year in the evidence>" (+ check before visiting if before 2018)
//  - restored / in use rows: condition preserved + a "Status: standing (restored / in use)" line
// Usage: node prep-rail.mjs <in.json> <out.json>
import fs from 'fs';
const [IN, OUT] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const stats = { types: {}, rule2002: 0, restored: 0 };
for (const r of rows) {
  let t = r.type;
  if (t === 'tower') t = /coal/i.test(r.name) ? 'coaling_tower' : 'interlocking';
  else if (t === 'rail_structure') t = /roundhouse/i.test(r.name) ? 'roundhouse' : 'other';
  stats.types[r.type + ' -> ' + t] = (stats.types[r.type + ' -> ' + t] || 0) + 1;
  r.type = t;
  const ev = Array.isArray(r.remains) ? r.remains.join(' ') : String(r.remains || '');
  const years = (ev.match(/\b(19[5-9]\d|20[0-2]\d)\b/g) || []).map(Number).filter(y => y <= 2026);
  const newest = years.length ? Math.max(...years) : null;
  const townCenter = /town cent/i.test(r.coord_quality || '');
  const kytcOnly = /KYTC/i.test(ev) && (!newest || newest <= 2003);
  let line;
  if (townCenter || kytcOnly) {
    line = 'Last confirmed standing: ~2002 (check before visiting)'; stats.rule2002++;
    if (!/^approx/i.test(r.coord_quality || '')) r.coord_quality = 'approximate: ' + (r.coord_quality || 'location from the c.2002 KYTC inventory');
  } else line = newest ? `Last confirmed standing: ${newest}${newest < 2018 ? ' (check before visiting)' : ''}` : 'Last confirmed standing: date of evidence not given (check before visiting)';
  const restored = /restored|in use/i.test(r.status || '');
  if (restored) stats.restored++;
  r.condition = restored ? 'preserved' : r.status === 'ruins' ? 'remains' : 'standing_ruin';
  r.remains = [line, ...(restored ? ['Status: standing (restored / in use)'] : []), ...(Array.isArray(r.remains) ? r.remains : r.remains ? [r.remains] : [])];
  if (r.railroad) r.line = r.railroad;
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(JSON.stringify(stats));
