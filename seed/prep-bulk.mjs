// Prepare ky-bulk.json (abandonedonline + OpenStreetMap bulk pull) for import-scan.mjs. Re-runnable: the source
// file keeps growing; rows with coord_quality "placeholder" are always dropped, and an optional placed-coordinates
// file (ky-bulk-placed.json: [{name, lat, lon, coord_quality}]) fills in rows when it exists.
//  - status intact -> standing (abandoned / standing_ruin); ruins -> remains; restored/in use -> preserved +
//    "Status: standing (restored / in use)"; unknown -> standing + "Condition unknown (check before visiting)"
// Usage: node prep-bulk.mjs <ky-bulk.json> <out.json> [ky-bulk-placed.json]
//   then: node import-scan.mjs <out.json> kybulk   (rows in FORCE_NEW never merge)
import fs from 'fs';
const [IN, OUT, PLACED] = process.argv.slice(2);
let rows = JSON.parse(fs.readFileSync(IN, 'utf8')); if (!Array.isArray(rows)) rows = Object.values(rows).find(Array.isArray);
const placed = PLACED && fs.existsSync(PLACED) ? new Map(JSON.parse(fs.readFileSync(PLACED, 'utf8')).map(p => [p.name, p])) : new Map();
// per-row fixes found on the first run: the abandonedonline "Big Woods, Red River & Lombard Railroad" point is the
// Nada Tunnel (same page), and an OSM railway=abandoned way carries only its road name
const FIX = {
  'Big Woods, Red River & Lombard Railroad': { name: 'Nada Tunnel (Big Woods, Red River & Lombard Railroad)', type: 'tunnel' },
  'Gracey Herndon Road': { name: 'Abandoned rail grade at Gracey Herndon Road', type: 'other' },
};
// town-center points stack on other pins in the same town; these rows are different places from the pin they land on
const FORCE_NEW = /^(The Princess Theatre|Willard Dry Fork Bridge|Camp Nelson Bridge|Mullins Limestone Mine|Morehead & North Fork Railroad|Olive Hill High School|Olive Hill Fire Brick|Flemingsburg & Northern Railroad|Mt\. Sterling Baptist Church|Mt\. Sterling High School)/;
// rows whose town-center point lands too far from the pin they already are (found by a name check on 23 Nov)
const MERGE_INTO = {
  'Raccoon Furnace': 'Raccoon Furnace',
  'Stearns Coal & Lumber Company': 'Stearns (Stearns Coal & Lumber Co.): company offices and district',
  'T.W. Samuels Distillery': 'T.W. Samuels Distillery Historic District, Deatsville',
  'Old Taylor Distillery': 'Old Taylor Distillery (Castle & Key)',
  'Frenchburg Presbyterian College': 'Frenchburg School Campus (Frenchburg Presbyterian College)',
};
const out = [], stats = { placeholder: 0, placed: 0, status: {} };
for (const src of rows) {
  const r = structuredClone(src);
  const p = placed.get(r.name);
  if (FORCE_NEW.test(r.name)) r.force_new = true;
  if (MERGE_INTO[r.name]) r.merge_into = MERGE_INTO[r.name];
  if (FIX[r.name]) Object.assign(r, FIX[r.name]);
  // placed rows flagged gone (demolished etc.) never become pins (remains-only rule)
  if (p && p.gone) { stats.gone = (stats.gone || 0) + 1; continue; }
  if (p && p.lat != null) { Object.assign(r, { lat: p.lat, lon: p.lon, coord_quality: p.coord_quality, county: r.county || p.county }); stats.placed++; }
  if (/^placeholder/i.test(r.coord_quality || '') || r.lat == null) { stats.placeholder++; continue; }
  const st = String(r.status || (p && p.status) || 'unknown').toLowerCase();
  stats.status[st] = (stats.status[st] || 0) + 1;
  const rem = (Array.isArray(r.remains) ? r.remains : r.remains ? [r.remains] : []).filter(x => String(x).trim());
  const lines = [];
  if (/restored|in use/i.test(st)) { r.condition = 'preserved'; lines.push('Status: standing (restored / in use)'); }
  else if (/ruin/i.test(st)) r.condition = 'remains';
  else { r.condition = 'standing_ruin'; if (/unknown/i.test(st)) lines.push('Condition unknown (check before visiting)'); }
  // the raw remains are often only a listing label ("Abandoned") or OSM tags; say where they came from
  const label = /^confirmed: OSM/i.test(r.coord_quality) ? 'OpenStreetMap tags: ' : 'abandonedonline listing: ';
  r.remains = [...lines, ...rem.map(x => String(x).length < 40 ? label + x : x)];
  out.push(r);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ in: rows.length, out: out.length, ...stats }));
