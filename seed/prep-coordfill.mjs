// Prepare coord-fill.json (coordinates found later for rows that were skipped for lacking them) for import-scan.mjs.
// Each fill row is joined to its full record in source_file (same folder, matched by name) and gets the found
// lat / lon / coord_quality. Rules from John's coordinator, 21 Nov 2026:
//  - SKIP Wrigley Arch (two conflicting points); Lenox / Leisure tunnel is approximate so its pin never moves
//  - Grays Knob + Crummies Creek come from the coal-camps gone file ("unlocated, remains reported"): coal_town,
//    approximate, "(check before visiting)"
//  - also skipped: Pactolus Furnace (source says demolished, remains-only rule), the Pennsylvania/Hopewell/Raccoon
//    row (only Raccoon located and it is already a pin), sites2 rows that repeat a furnace/tunnel row in this file,
//    and Garred Chapel (its pin is 25 km off, moved by hand instead of through the 10 km merge window)
// Usage: node prep-coordfill.mjs <folder> <out.json>
import fs from 'fs'; import path from 'path';
const [DIR, OUT] = process.argv.slice(2);
const fill = JSON.parse(fs.readFileSync(path.join(DIR, 'coord-fill.json'), 'utf8'));
const cache = {}; const src = f => cache[f] ??= JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const SKIP = /^(Wrigley Arch|Pactolus Furnace|Pennsylvania, Hopewell and Raccoon|Garred Chapel)/;
const DUP_OF_OTHER_FILE = /^(Caney Tunnel \(Morgan|New Hampshire Furnace|Pine Grove Furnace \(Greenup County|Laurel Furnace stack|Torrent Tunnel \(L&E)/;
const inferType = n => /\btown\b|lumber town/i.test(n) ? 'ghost_town' : /tunnel/i.test(n) ? 'tunnel' : /furnace/i.test(n) ? 'iron_furnace' : /bridge/i.test(n) ? 'bridge'
  : /depot/i.test(n) ? 'depot' : /\bmine/i.test(n) ? 'mine' : /church|chapel|school|distillery|house|store|buildings/i.test(n) ? 'lost_building'
  : /\btown\b|lumber town/i.test(n) ? 'ghost_town' : 'other';
const out = [], skipped = [];
for (const c of fill) {
  if (SKIP.test(c.name) || (c.source_file === 'sites2.json' && DUP_OF_OTHER_FILE.test(c.name))) { skipped.push(c.name); continue; }
  const rows = src(c.source_file);
  let r = rows.find(x => x.name === c.name) || rows.find(x => c.name.startsWith(x.name));
  if (!r) { skipped.push(c.name + ' (no source record)'); continue; }
  r = structuredClone(r);
  const approx = !/^confirmed/i.test(c.coord_quality);
  Object.assign(r, { lat: c.lat, lon: c.lon, coord_quality: c.coord_quality + (approx && c.note ? '; ' + c.note : '') });
  if (c.source_file === 'ky-coal-camps-gone.json') {
    r.type = 'coal_town';
    r.history = r.why_gone.replace(/,? but no (GNIS point or other )?coordinate found.*$/i, '.').replace(/\s*so it is NOT mapped.*$/i, '');
    r.remains = [`Remains reported on coalcampusa (${/20\d\d/.exec(r.why_gone)?.[0] || 'photo undated'}) (check before visiting)`];
    if (!/^approx/i.test(r.coord_quality)) r.coord_quality = 'approximate: ' + r.coord_quality;
  }
  if (c.source_file === 'ky-abandoned.json') {
    const ev = Array.isArray(r.remains) ? r.remains.join(' ') : String(r.remains || '');
    const ys = (ev.match(/\b(19[5-9]\d|20[0-2]\d)\b/g) || []).map(Number); const y = ys.length ? Math.max(...ys) : null;
    r.remains = [y ? `Last confirmed standing: ${y}${y < 2018 ? ' (check before visiting)' : ''}` : 'Last confirmed standing: date of evidence not given (check before visiting)', ...(Array.isArray(r.remains) ? r.remains : r.remains ? [r.remains] : [])];
    if (r.notes) r.history = [r.history, 'Note: ' + r.notes.replace(/No (sound )?coordinates[^.]*\.\s*|not pinned\.\s*/gi, '')].filter(Boolean).join('\n\n');
    if (!['lost_building', 'other', 'ghost_town', 'depot', 'bridge', 'mine'].includes(r.type)) r.type = 'lost_building';
  }
  if (!r.type || r.type === 'furnace') r.type = r.type === 'furnace' ? 'iron_furnace' : inferType(r.name);
  out.push(r);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ rows: out.length, skipped }));
