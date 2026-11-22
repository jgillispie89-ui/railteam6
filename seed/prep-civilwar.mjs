// Prepare ky-civil-war.json for import-scan.mjs.
//  - no military type in the schema: earthworks and batteries are "other" (they are not buildings)
//  - park / monument centre points, GNIS name points and shared NRHP points get the approximate badge
//  - public sites: "no metal detecting on park/federal land" added to access unless it already says so
//  - "Last confirmed: <newest year in the evidence>" line as in the other scan imports
//  - rows without coordinates (Fort Mitchel) are left for import-scan to skip
// Usage: node prep-civilwar.mjs <in.json> <out.json>
import fs from 'fs';
const [IN, OUT] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const stats = { approx: 0, metal: 0 };
for (const r of rows) {
  r.type = 'other';
  const cq = String(r.coord_quality || '');
  if (/cent(re|er)|approximate|shared|name point/i.test(cq)) { r.coord_quality = 'approximate: ' + cq.replace(/^approximate:?\s*/i, ''); stats.approx++; }
  else r.coord_quality = 'confirmed: ' + cq;
  if (/^public/i.test(r.access || '') && !/metal/i.test(r.access)) { r.access += '; no metal detecting on park/federal land'; stats.metal++; }
  const rem = Array.isArray(r.remains) ? r.remains : r.remains ? [r.remains] : [];
  const ys = (rem.join(' ').match(/\b(19[5-9]\d|20[0-2]\d)\b/g) || []).map(Number).filter(y => y <= 2026);
  const y = ys.length ? Math.max(...ys) : null;
  r.remains = [y ? `Last confirmed: ${y}${y < 2018 ? ' (check before visiting)' : ''}` : 'Last confirmed: date of evidence not given (check before visiting)', ...rem];
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(JSON.stringify(stats));
