// Prepare oh-hanging-rock-furnaces.json for import-scan.mjs (rows without coordinates are skipped by the importer).
//  - low-confidence rows (the file says LOW CONFIDENCE / UNVERIFIED, or the point is only approximate) get a
//    "Low confidence (check before visiting)" first line
//  - Buckeye Furnace is a restored state memorial: preserved + "Status: standing (restored / in use)"
// Usage: node prep-oh-furnaces.mjs <in.json> <out.json>
import fs from 'fs';
const [IN, OUT] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
let low = 0;
for (const r of rows) {
  r.type = 'iron_furnace'; r.state = r.state || 'OH';
  const rem = Array.isArray(r.remains) ? r.remains : r.remains ? [r.remains] : [];
  const lines = [];
  if (/LOW CONFIDENCE|UNVERIFIED/.test(rem.join(' ')) || /^approx/i.test(r.coord_quality || '')) { lines.push('Low confidence (check before visiting)'); low++; }
  if (/^Buckeye Furnace/.test(r.name)) { r.condition = 'preserved'; lines.push('Status: standing (restored / in use)'); }
  r.remains = [...lines, ...rem];
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(JSON.stringify({ rows: rows.length, low }));
