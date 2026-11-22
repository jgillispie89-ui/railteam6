// Prepare ky-locks-dams.json for import-scan.mjs.
//  - rows flagged needs_coords are dropped; the schema has no lock type, so type stays "other"
//  - "Last confirmed: <newest year in the evidence>" line (+ check before visiting if before 2018)
//  - active locks: status active + "Status: in use (working lock, view from public areas only)"
//  - anything with a dam: "drowning hazard near dam" added to access (sets the danger badge)
// Usage: node prep-locks.mjs <in.json> <out.json>
import fs from 'fs';
const [IN, OUT] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const out = [], stats = { dropped: [], active: 0, dams: 0 };
for (const r of rows) {
  if (r.needs_coords) { stats.dropped.push(r.name); continue; }
  r.type = 'other';
  const rem = Array.isArray(r.remains) ? r.remains : r.remains ? [r.remains] : [];
  const years = (rem.join(' ').match(/\b(19[5-9]\d|20[0-2]\d)\b/g) || []).map(Number).filter(y => y <= 2026);
  const newest = years.length ? Math.max(...years) : null;
  const lines = [newest ? `Last confirmed: ${newest}${newest < 2018 ? ' (check before visiting)' : ''}` : 'Last confirmed: date of evidence not given (check before visiting)'];
  if (r.status === 'active') {
    stats.active++; r.condition = 'active';
    lines.push(r.subtype === 'lock' ? 'Status: in use (working lock, view from public areas only)' : 'Status: in use');
  } else r.condition = r.status === 'park' ? 'preserved' : r.status === 'abandoned' ? 'standing_ruin' : 'remains';
  if (/\bdam\b/i.test(r.name) && !/drown/i.test(r.access || '')) { stats.dams++; r.access = (r.access ? r.access + '; ' : '') + 'drowning hazard near dam'; }
  else if (/\bdam\b/i.test(r.name)) stats.dams++;
  r.remains = [...lines, ...rem];
  out.push(r);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(stats));
