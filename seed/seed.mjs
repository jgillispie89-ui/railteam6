// Seed the Lost Places map with REAL, sourced pins (2026-11-20).
//   node seed.mjs [--limit N] [--only ashland|nationwide] [--dry]
// Secrets come from C:\Users\User\credentials\.env and keys.json (never printed).
// Facts: Wikipedia intro text (quoted, CC BY-SA, credited), Wikidata dates/places,
// Wikipedia coordinates; Ashland region from the Desktop map pack + a sourced research file.
// Photos: Wikimedia Commons only, free licenses only (PD / CC0 / CC BY / CC BY-SA), copied into
// the private Supabase bucket at <=1600 px WebP with credit, license and source page recorded.
import fs from 'fs';
import pg from 'pg';
import sharp from 'sharp';
import crypto from 'crypto';

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : Infinity;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const DRY = args.includes('--dry');
const UA = 'LostPlacesMapSeeder/1.0 (private, non-commercial history map)';
const SUPA = 'https://icvommgyfhdioiofeftd.supabase.co';
const BUCKET = 'railteam6-photos';
const MAX_TOTAL_BYTES = 400 * 1024 * 1024;

const envTxt = fs.readFileSync('C:/Users/User/credentials/.env', 'utf8');
const envGet = (k) => (envTxt.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^"|"$/g, '');
const SERVICE = JSON.parse(fs.readFileSync('C:/Users/User/rt6_migration/keys.json', 'utf8')).find(k => k.name === 'service_role').api_key;
const db = new pg.Pool({ max: 2, idleTimeoutMillis: 20000, host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, database: 'postgres',
    user: 'railteam6_app.icvommgyfhdioiofeftd', password: envGet('RAILTEAM6_SUPABASE_DB_PASSWORD'), ssl: { rejectUnauthorized: false } });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/\s+/g, ' ').trim();

async function getJSON(url, tries = 9) {
    for (let i = 0; i < tries; i++) {
        const r = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
        if (r.status === 429 || r.status >= 500) {
            const ra = +(r.headers.get('retry-after') || 0);
            await sleep(Math.max(ra * 1000, Math.min(60000, 4000 * 2 ** i))); continue;
        }
        if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 120)}`);
        const body = await r.text();
        try { return JSON.parse(body); }
        catch { // Wikimedia sometimes answers "too many requests" as plain text: back off and retry
            await sleep(Math.min(60000, 5000 * 2 ** i)); continue;
        }
    }
    throw new Error('gave up ' + url.slice(0, 120));
}
async function getBuf(url, tries = 5) {
    for (let i = 0; i < tries; i++) {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (r.status === 429 || r.status >= 500) { await sleep(4000 * (i + 1)); continue; }
        if (!r.ok) throw new Error(`${r.status} image`);
        return Buffer.from(await r.arrayBuffer());
    }
    throw new Error('image gave up');
}
const WP = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&';
const WC = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&';

// ---------- Wikipedia + Wikidata ----------
async function wikiIntro(title) {
    const j = await getJSON(WP + 'action=query&redirects=1&prop=extracts|coordinates|pageprops&ppprop=wikibase_item&exintro=1&explaintext=1&titles=' + encodeURIComponent(title));
    const p = j.query?.pages?.[0];
    if (!p || p.missing) return null;
    const paras = (p.extract || '').split(/\n+/).map(s => s.trim()).filter(s => s.length > 40).slice(0, 4);
    return { title: p.title, text: paras.join('\n\n'), coords: p.coordinates?.[0], qid: p.pageprops?.wikibase_item };
}
const claimTime = (e, pid) => {
    const v = e?.claims?.[pid]?.[0]?.mainsnak?.datavalue?.value?.time;
    const m = v && v.match(/^\+?(\d{4})/);
    return m ? +m[1] : null;
};
const claimStr = (e, pid) => e?.claims?.[pid]?.[0]?.mainsnak?.datavalue?.value ?? null;
async function wikidata(qid) {
    const j = await getJSON('https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&props=claims&ids=' + qid);
    const e = j.entities?.[qid];
    const loc = e?.claims?.P131?.[0]?.mainsnak?.datavalue?.value?.id;
    let locLabel = null;
    if (loc) {
        const l = await getJSON('https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&props=labels&languages=en&ids=' + loc);
        locLabel = l.entities?.[loc]?.labels?.en?.value || null;
    }
    return {
        built: claimTime(e, 'P571') ?? claimTime(e, 'P1619'),
        closed: claimTime(e, 'P576') ?? claimTime(e, 'P3999') ?? claimTime(e, 'P730'),
        loc: locLabel, nrhp: claimStr(e, 'P649'), gnis: claimStr(e, 'P590'),
        image: claimStr(e, 'P18'), commonsCat: claimStr(e, 'P373'),
    };
}
const STATE_NAMES = new Set(['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming']);
function placeFrom(locLabel) {
    if (!locLabel || STATE_NAMES.has(locLabel)) return {};
    const l = locLabel.replace(/,.*$/, '');
    if (/ (County|Parish|Borough|Census Area)$/.test(l)) return { county: l.replace(/ County$/, '') };
    if (/Township|National|Forest|Park|District|Recreation/.test(l)) return {};
    return { city: l };
}

// ---------- Commons photos ----------
const OK_LICENSE = (l) => /public domain|^pd|cc0|cc[ -]by(-sa)?([ -]\d|$)|attribution/i.test(l || '') && !/nc|nd|fair|non-free|copyrighted/i.test(l || '');
const BAD_TITLE = /\b(maps?|locator|seal|flag|logo|coat of arms|diagram|plan|sheet|drawing|elevation|section|svg|marker text|signature|portrait|census|enumeration|newspaper|obituary|clipping|article|document|letter|certificate|stamp|postmark|banknote|coin|advertisement|etching|engraving|lithograph|painting|sketch|page \d|scan of|chart|graph|grave|headstone|tombstone)\b/i;
const IIPROPS = 'prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1920&iiextmetadatafilter=DateTimeOriginal|LicenseShortName|Artist|Credit|ImageDescription|ObjectName';
function fileInfo(p) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/image\/(jpeg|png|tiff|webp)/.test(ii.mime || '')) return null;
    if (BAD_TITLE.test(p.title)) return null;
    const md = ii.extmetadata || {};
    const lic = strip(md.LicenseShortName?.value);
    if (!OK_LICENSE(lic)) return null;
    if ((ii.width || 0) < 500 && (ii.height || 0) < 500) return null;
    const dateTxt = strip(md.DateTimeOriginal?.value) + ' ';
    let y = (dateTxt.match(/\b(1[89]\d\d|20[0-2]\d)\b/) || [])[1];
    if (!y) y = (p.title.match(/\b(18[4-9]\d|19[0-6]\d)\b/) || [])[1]; // e.g. HABS / LOC file names
    const year = y ? +y : null;
    let artist = strip(md.Artist?.value).slice(0, 200);
    if (!artist || /^unknown/i.test(artist)) artist = strip(md.Credit?.value).slice(0, 200) || 'Unknown photographer';
    const desc = strip(md.ImageDescription?.value).replace(/(^|[ (])en:/g, '$1').slice(0, 300);
    if (BAD_TITLE.test(desc)) return null; // descriptions catch scans/clippings the file name hides
    return { title: p.title, thumb: ii.thumburl || ii.url, page: ii.descriptionurl, license: lic, credit: artist, year,
        caption: desc || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), w: ii.width, h: ii.height };
}
async function commonsFiles(titles) {
    if (!titles.length) return [];
    const j = await getJSON(WC + 'action=query&' + IIPROPS + '&titles=' + encodeURIComponent(titles.join('|')));
    return (j.query?.pages || []).map(fileInfo).filter(Boolean);
}
async function commonsCategory(cat, depth = 1) {
    const out = [];
    const j = await getJSON(WC + 'action=query&generator=categorymembers&gcmtype=file&gcmlimit=80&' + IIPROPS + '&gcmtitle=' + encodeURIComponent('Category:' + cat));
    out.push(...(j.query?.pages || []).map(fileInfo).filter(Boolean));
    if (depth > 0) {
        const s = await getJSON(WC + 'action=query&list=categorymembers&cmtype=subcat&cmlimit=40&cmtitle=' + encodeURIComponent('Category:' + cat));
        const subs = (s.query?.categorymembers || []).map(c => c.title.replace(/^Category:/, ''))
            .filter(t => /HABS|HAER|histor|old|vintage|Library of Congress|18\d\d|19[0-6]\d|ruin|remains/i.test(t)).slice(0, 4);
        for (const sc of subs) out.push(...await commonsCategory(sc, 0));
    }
    return out;
}
// Ashland region only: accept a category ONLY if it is this exact name (optionally "(Ohio)"/", Kentucky")
// AND the category itself sits under a Kentucky/Ohio parent. Prevents look-alikes in other states.
const REGION = /Kentucky|Ohio|Greenup|Boyd County|Carter County|Lawrence County|Ironton|Ashland/i;
async function findCommonsCategory(name) {
    const j = await getJSON(WC + 'action=query&list=search&srnamespace=14&srlimit=8&srsearch=' + encodeURIComponent(`intitle:"${name}"`));
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + esc + '( \\((Ohio|Kentucky)\\)|, (Ohio|Kentucky))?$', 'i');
    for (const t of (j.query?.search || []).map(x => x.title.replace(/^Category:/, '')).filter(t => re.test(t))) {
        const c = await getJSON(WC + 'action=query&prop=categories&cllimit=50&titles=' + encodeURIComponent('Category:' + t));
        const parents = (c.query?.pages?.[0]?.categories || []).map(x => x.title).join(' | ');
        if (REGION.test(t) || REGION.test(parents)) return t;
    }
    return null;
}
function pickPhotos(files, mainImage, name) {
    const kw = (keyWord(name || '') || '').toLowerCase();
    const uniq = [...new Map(files.map(f => [f.title, f])).values()];
    const then = uniq.filter(f => f.year && f.year <= 1965 && kw && (f.title + ' ' + f.caption).toLowerCase().includes(kw)).sort((a, b) => a.year - b.year || (b.w * b.h) - (a.w * a.h)).slice(0, 2);
    const main = uniq.find(f => f.title === mainImage);
    let now = null;
    if (main && (!main.year || main.year >= 1990)) now = main;
    if (!now) now = uniq.filter(f => f.year && f.year >= 1995).sort((a, b) => b.year - a.year)[0] || null;
    const out = then.map(f => ({ ...f, era: 'then' }));
    if (now && !then.includes(now)) out.push({ ...now, era: 'now' });
    return out;
}

// ---------- Library of Congress fallback (public domain collections only) ----------
const STATE_FULL = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };
const STATE_OLD = { AL:['Ala.'],AZ:['Ariz.'],AR:['Ark.'],CA:['Cal.','Calif.'],CO:['Colo.'],CT:['Conn.'],DE:['Del.'],FL:['Fla.'],GA:['Ga.'],IL:['Ill.'],IN:['Ind.'],KS:['Kan.','Kans.'],KY:['Ky.'],LA:['La.'],MD:['Md.'],MA:['Mass.'],MI:['Mich.'],MN:['Minn.'],MS:['Miss.'],MO:['Mo.'],MT:['Mont.'],NE:['Neb.','Nebr.'],NV:['Nev.'],NH:['N.H.'],NJ:['N.J.'],NM:['N.M.','N. Mex.'],NY:['N.Y.'],NC:['N.C.'],ND:['N.D.','N. Dak.'],OK:['Okla.'],OR:['Ore.','Oreg.'],PA:['Pa.','Penn.'],RI:['R.I.'],SC:['S.C.'],SD:['S.D.','S. Dak.'],TN:['Tenn.'],TX:['Tex.'],VT:['Vt.'],VA:['Va.'],WA:['Wash.'],WV:['W. Va.','W.Va.'],WI:['Wis.'],WY:['Wyo.'] };
const GENERIC = new Set(['furnace','iron','mine','mines','mill','tunnel','bridge','depot','station','town','city','historic','district','site','state','park','national','ghost','company','coal','old','lake','mount','saint','north','south','east','west','county','village','miners']);
function keyWord(name) {
    const words = name.replace(/\(.*?\)/g, '').split(/[^A-Za-z']+/).filter(w => w.length >= 4 && !GENERIC.has(w.toLowerCase()));
    return words.sort((a, b) => b.length - a.length)[0] || null;
}
async function locPhotos(name, st) {
    const kw = keyWord(name);
    if (!kw || !STATE_FULL[st]) return [];
    const stateNames = [STATE_FULL[st], ...(STATE_OLD[st] || [])];
    const j = await getJSON('https://www.loc.gov/photos/?fo=json&c=40&fa=online-format:image&q=' + encodeURIComponent(kw + ' ' + STATE_FULL[st])).catch(() => null);
    const out = [];
    for (const r of j?.results || []) {
        const t = String(r.title || '');
        // Strict: the whole place name (e.g. "Laurel Furnace", "Thurmond") must be in the title, plus the state.
        const phrase = name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/^Mt\. /, 'Mount ').trim().toLowerCase();
        const tl = t.toLowerCase().replace(/\bmt\. /g, 'mount ');
        if (!tl.includes(phrase) || !stateNames.some(s => t.includes(s))) continue;
        const img = (r.image_url || []).slice(-1)[0];
        if (!img) continue;
        const coll = /\/pnp\/det\//.test(img) ? 'Detroit Publishing Co. collection'
            : /\/pnp\/fsa|service:pnp:fsa/.test(img) ? 'Farm Security Administration / Office of War Information'
            : /highsm/.test(img) ? 'Carol M. Highsmith Archive' : null;
        if (!coll) continue; // only collections the LOC marks "no known restrictions"
        const year = +(String(r.date || '').match(/^(\d{4})/) || [])[1] || null;
        const m = img.match(/#h=(\d+)&w=(\d+)/);
        const who = Array.isArray(r.contributor) && r.contributor[0] ? r.contributor[0] + ', ' : '';
        out.push({ title: 'LOC ' + r.url, thumb: img.replace(/#.*$/, ''), page: r.url, year,
            license: 'Public domain (Library of Congress: no known restrictions)', credit: who + coll + ', Library of Congress',
            caption: t.replace(/^\[|\]$/g, '').slice(0, 300), w: m ? +m[2] : 1024, h: m ? +m[1] : 768 });
    }
    return out;
}

// ---------- Storage ----------
let totalBytes = 0;
async function putObject(path, buf) {
    const r = await fetch(`${SUPA}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST',
        headers: { Authorization: 'Bearer ' + SERVICE, apikey: SERVICE, 'Content-Type': 'image/webp', 'x-upsert': 'true' }, body: buf });
    if (!r.ok) throw new Error('storage ' + r.status + ' ' + (await r.text()).slice(0, 120));
}
async function storePhoto(siteId, f, order, userId) {
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('storage budget reached');
    const raw = await getBuf(f.thumb);
    const img = sharp(raw, { failOn: 'none' }).rotate();
    const full = await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    const thumb = await img.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    const stem = 'seed-' + crypto.randomUUID();
    await putObject(`photos/${stem}.webp`, full.data);
    await putObject(`thumbs/${stem}.webp`, thumb);
    totalBytes += full.data.length + thumb.length;
    await db.query(`INSERT INTO photos (site_id, era, storage_path, thumb_path, url, caption, taken_year, credit, photographer,
                        license, source_url, is_historic, uploaded_by, sort_order, width, height, bytes)
                    VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [siteId, f.era, `photos/${stem}.webp`, `thumbs/${stem}.webp`, f.caption, f.year, f.credit, f.license, f.page,
         f.era === 'then', userId, order, full.info.width, full.info.height, full.data.length]);
}

// ---------- DB ----------
async function insertSite(s, userId) {
    const ex = await db.query('SELECT id FROM sites WHERE seed_key = $1', [s.seed_key]);
    if (ex.rows.length) return null;
    const STATUS = { preserved: 'preserved', standing_ruin: 'abandoned', remains: 'ruins', gone: 'destroyed', unknown: 'unknown' };
    const cond = STATUS[s.condition] ? s.condition : 'unknown';
    const { rows } = await db.query(
        `INSERT INTO sites (name, site_type, status, condition, geom, built_year, closed_year, city, county, state_province,
            description, history_credit, is_private_land, is_dangerous, coords_approx, coords_note, wikipedia_url,
            external_refs, seed_key, mod_status, submitted_by, verified)
         VALUES ($1,$2::site_type,$3::site_status,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'approved',$21,true)
         RETURNING id`,
        [s.name, s.type, STATUS[cond], cond, s.lon, s.lat, s.built ?? null, s.closed ?? null, s.city ?? null, s.county ?? null,
         s.state ?? null, s.history || null, s.history_credit || null, !!s.private, !!s.dangerous, !!s.approx, s.coords_note || null,
         s.wikipedia_url || null, JSON.stringify(s.refs || {}), s.seed_key, userId]);
    const id = rows[0].id;
    let i = 0;
    for (const src of s.sources || []) {
        if (!src.url && !src.title) continue;
        await db.query('INSERT INTO sources (site_id, kind, citation, url, sort_order) VALUES ($1,$2,$3,$4,$5)',
            [id, 'website', src.title || src.url, src.url || null, i++]);
    }
    return id;
}

// ---------- Builders ----------
async function buildNationwide(c) {
    const w = await wikiIntro(c.wiki);
    if (!w || !w.coords) return { skip: 'no article/coords' };
    const qid = w.qid || c.qid;
    const d = qid ? await wikidata(qid) : {};
    const name = w.title.replace(/,\s*[A-Z][a-z]+( [A-Z][a-z]+)?$/, '').replace(/\s*\([^)]*\)$/, '');
    const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(w.title.replace(/ /g, '_'));
    const sources = [{ title: `Wikipedia: ${w.title}`, url }];
    if (qid) sources.push({ title: `Wikidata ${qid}`, url: 'https://www.wikidata.org/wiki/' + qid });
    if (d.nrhp) sources.push({ title: `National Register of Historic Places #${d.nrhp}`, url: `https://npgallery.nps.gov/AssetDetail/NRIS/${d.nrhp}` });
    if (d.gnis) sources.push({ title: `USGS GNIS feature ${d.gnis}`, url: `https://edits.nationalmap.gov/apps/gaz-domestic/public/gaz-record/${d.gnis}` });
    const place = placeFrom(d.loc);
    if (/(town|coal_town|ghost_town|lost_town)/.test(c.type) && !place.city) place.city = name;
    return {
        site: {
            seed_key: 'wiki:' + (qid || w.title), name, type: c.type, condition: c.condition, lat: w.coords.lat, lon: w.coords.lon,
            built: d.built, closed: d.closed, state: c.state, ...place,
            history: w.text, history_credit: `History text quoted from Wikipedia, "${w.title}" (CC BY-SA 4.0). Coordinates from Wikipedia.`,
            wikipedia_url: url, refs: { wikidata: qid, nrhp: d.nrhp, gnis: d.gnis }, sources,
        },
        photoSource: { cat: d.commonsCat, image: d.image ? 'File:' + d.image : null },
    };
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function loadAshland() {
    const kml = fs.readFileSync('C:/Users/User/OneDrive/Desktop/Ashland Rail and Mines/Ashland-rail-and-mines.kml', 'utf8');
    const research = JSON.parse(fs.readFileSync(new URL('./ashland-candidates.json', import.meta.url), 'utf8'));
    const CONFIRMED = /^(Sandy Furnace|Vesuvius Furnace \(Ohio\))$/; // only these two are confirmed (map pack + coordinator)
    const MATCH = { 'EK Tunnel 3 - Argillite': 'Argillite Tunnel', 'EK Tunnel 4 - Callahan': 'Callahan Tunnel', 'EK Tunnel 5 - Ramey': 'Ramey Tunnel',
        'Buffalo Furnace': 'Buffalo Furnace', 'Laurel Furnace marker': 'Laurel Furnace', 'Hunnewell Furnace': 'Hunnewell Furnace',
        'Mt. Savage Furnace': 'Mt. Savage Furnace', 'Sandy Furnace': 'Sandy Furnace', 'Amanda Furnace marker': 'Amanda Furnace',
        'Bellefonte Furnace marker': 'Bellefonte Furnace', 'Vesuvius Furnace (Ohio)': 'Vesuvius Furnace', 'Vesuvius (Royersville) Tunnel - Ohio': 'Vesuvius (Royersville) Tunnel' };
    const TYPE = (n) => /tunnel/i.test(n) ? 'tunnel' : /furnace/i.test(n) ? 'iron_furnace' : 'other';
    const COUNTY = { 'Argillite': 'Greenup', 'Callahan': 'Greenup', 'Ramey': 'Greenup', 'Buffalo': 'Greenup', 'Laurel': 'Greenup', 'Hunnewell': 'Greenup',
        'Mt. Savage': 'Carter', 'Sandy': 'Boyd', 'Clinton': 'Boyd', 'Star': 'Carter', 'Amanda': 'Boyd', 'Bellefonte': 'Boyd', 'Aden': 'Carter', 'Means': 'Carter' };
    const readme = fs.readFileSync('C:/Users/User/OneDrive/Desktop/Ashland Rail and Mines/README.md', 'utf8');
    const condCol = {};
    for (const line of readme.split(/\r?\n/)) {
        const cells = line.split('|').map(x => x.trim());
        if (cells.length >= 9 && /^-?\d+\.\d+, -?\d+\.\d+$/.test(cells[3])) condCol[cells[1]] = cells[5];
    }
    const used = new Set(), out = [];
    for (const m of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
        const pm = m[1];
        const rawName = strip((pm.match(/<name>([\s\S]*?)<\/name>/) || [])[1]);
        const pt = (pm.match(/<Point>\s*<coordinates>([^<]+)<\/coordinates>/) || [])[1];
        if (!pt) continue;                                    // route line: NOT real track, skipped
        if (/Big and Hopewell tunnels/i.test(rawName)) continue; // no tunnel coordinates exist: not pinned
        const [lon, lat] = pt.trim().split(',').map(Number);
        const desc = strip((pm.match(/<description>([\s\S]*?)<\/description>/) || [])[1]).replace(/<!\[CDATA\[|\]\]>/g, '');
        const coordTxt = (desc.match(/COORDINATES:\s*(.*?)\.\s*(CONDITION|ACCESS|$)/) || [])[1] || '';
        const access = (desc.match(/ACCESS:\s*(.*?)\.\s*COORDINATES/) || [])[1] || '';
        const condTxt = condCol[rawName] ?? '';
        const urls = [...desc.matchAll(/https?:\/\/[^\s;]+/g)].map(x => x[0].replace(/[.,)]+$/, ''));
        const key = Object.keys(MATCH).find(k => rawName.startsWith(k));
        const r = key ? research.find(x => x.name.startsWith(MATCH[key])) : null;
        if (r) used.add(r.name);
        const confirmed = CONFIRMED.test(rawName);
        const cond = /demolish|gone/i.test(condTxt) ? 'gone' : /^unknown/i.test(condTxt) ? 'unknown' : /intact|stands|standing|still open/i.test(condTxt) ? 'standing_ruin'
            : /ruin|collapsed|filled|sealed|caved/i.test(condTxt) ? 'remains' : (r?.condition || 'unknown');
        const word = (rawName.match(/(Argillite|Callahan|Ramey|Buffalo|Laurel|Hunnewell|Mt\. Savage|Sandy|Clinton|Star|Amanda|Bellefonte|Aden|Means)/) || [])[1];
        const name = rawName.replace(/\s*-\s*likely gone$/, '').replace(/ marker \(furnace gone\)$/, '').replace(/ marker \(furnace itself is ~4 miles west\)$/, '')
            .replace(/^EK Tunnel (\d) - (\w+)$/, '$2 Tunnel (Eastern Kentucky Railway No. $1)').replace(/ - Ohio$/, '').replace(/ \(Ohio\)$/, '').replace(/ \(KY\)$/, '');
        const sources = [...(r?.sources || []).map(s => ({ title: s.title, url: s.url }))];
        for (const u of urls) if (!sources.some(s => s.url === u)) sources.push({ title: u.replace(/^https?:\/\/(www\.)?/, ''), url: u });
        sources.push({ title: 'Ashland Rail and Mines map pack (README.md + KML, compiled 20 Nov 2026 from the sources above)', url: null });
        const history = r?.history || desc.replace(/^.*?CONDITION:\s*/, 'Condition: ').replace(/Source:.*$/, '').trim();
        out.push({
            seed_key: 'ashland:' + slug(name), name, type: r?.type && r.type !== 'other' ? r.type : TYPE(rawName),
            condition: cond, lat, lon, approx: !confirmed,
            coords_note: confirmed ? null : `Approximate: ${coordTxt.replace(/^APPROXIMATE\s*/i, '').replace(/^\(|\)$/g, '') || 'not confirmed on the ground'}.`,
            private: /private/i.test(access), dangerous: /DANGEROUS/.test(access) || /tunnel/i.test(rawName),
            built: r?.built_year ?? null, closed: r?.closed_year ?? null,
            county: r?.county || COUNTY[word] || null, state: r?.state || (/Ohio|Vesuvius/.test(rawName) ? 'OH' : 'KY'),
            history: history + (access ? `\n\nAccess (from the map pack): ${access}.` : ''),
            history_credit: 'Summary written from the sources listed below (not a quote). Nothing here was visited in person.',
            sources, commonsName: name.replace(/\s*\(.*$/, ''),
            wikiForPhoto: r?.wiki && r.wiki !== 'Eastern Kentucky Railway' && !/,/.test(r.wiki) ? r.wiki : null,
        });
    }
    for (const r of research) {
        if (used.has(r.name)) continue;
        if (/railroad shop/i.test(r.name)) continue; // same point as Hunnewell Furnace, no separate location
        out.push({
            seed_key: 'ashland:' + slug(r.name), name: r.name, type: r.type, condition: r.condition, lat: r.lat, lon: r.lon,
            approx: r.coords_approx !== false,
            coords_note: r.coords_approx !== false ? `Approximate: from ${r.coord_source || 'a single source'}; the real spot may be some distance away.` : null,
            dangerous: r.type === 'tunnel', built: r.built_year ?? null, closed: r.closed_year ?? null,
            county: r.county, state: r.state, history: r.history,
            history_credit: 'Summary written from the sources listed below (not a quote). Nothing here was visited in person.',
            sources: (r.sources || []).map(s => ({ title: s.title, url: s.url })),
            commonsName: r.name.replace(/\s*\(.*$/, ''),
            wikiForPhoto: r.wiki && r.wiki !== 'Eastern Kentucky Railway' && !/,/.test(r.wiki) ? r.wiki : null,
        });
    }
    return out;
}

// ---------- Main ----------
(async () => {
    db.on('error', (e) => log('db idle error (ignored)', e.message));
    // Owner = the map's single admin account (looked up by role, not by address).
    const uid = (await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
    const report = { added: 0, skipped: [], photos: 0, errors: [] };
    const jobs = [];
    if (ONLY !== 'nationwide') for (const a of loadAshland()) jobs.push({ kind: 'ashland', a });
    if (ONLY !== 'ashland') for (const c of JSON.parse(fs.readFileSync(new URL('./nationwide-candidates.json', import.meta.url), 'utf8'))) jobs.push({ kind: 'wiki', c });
    let n = 0;
    for (const j of jobs) {
        if (n >= LIMIT) break;
        n++;
        try {
            let site, photoSource;
            if (j.kind === 'wiki') {
                const b = await buildNationwide(j.c);
                if (b.skip) { report.skipped.push(`${j.c.wiki}: ${b.skip}`); continue; }
                ({ site, photoSource } = b);
            } else {
                site = j.a;
                let cat = null, image = null;
                if (site.wikiForPhoto) {
                    const w = await wikiIntro(site.wikiForPhoto);
                    if (w?.qid) { const d = await wikidata(w.qid); cat = d.commonsCat; image = d.image ? 'File:' + d.image : null; }
                }
                if (!cat) cat = await findCommonsCategory(site.commonsName).catch(() => null);
                photoSource = { cat, image };
            }
            if (DRY) { log('DRY', site.type, site.name, site.lat, site.lon, site.approx ? 'approx' : 'exact', site.condition, photoSource.cat || '-', photoSource.image || ''); continue; }
            let id = await insertSite(site, uid);
            let haveEras = new Set(), order = 0;
            if (!id) {
                const ex = await db.query(`SELECT s.id, ARRAY(SELECT DISTINCT era FROM photos p WHERE p.site_id = s.id AND p.deleted_at IS NULL) AS eras,
                    (SELECT COUNT(*)::int FROM photos p WHERE p.site_id = s.id) AS n FROM sites s WHERE seed_key = $1`, [site.seed_key]);
                haveEras = new Set(ex.rows[0].eras);
                if (haveEras.has('then') && haveEras.has('now')) { report.skipped.push(`${site.name}: already seeded`); continue; }
                id = ex.rows[0].id; order = ex.rows[0].n; // seeded earlier: fill only the missing era
            } else report.added++;
            let files = [];
            if (photoSource.cat) files.push(...await commonsCategory(photoSource.cat).catch(e => { report.errors.push(site.name + ' cat ' + e.message); return []; }));
            if (photoSource.image) files.push(...await commonsFiles([photoSource.image]).catch(() => []));
            let picks = pickPhotos(files, photoSource.image, site.name);
            if (!picks.some(p => p.era === 'then') || !picks.some(p => p.era === 'now')) {
                const loc = await locPhotos(site.name, site.state);
                const lthen = loc.filter(f => f.year && f.year <= 1950).sort((a, b) => a.year - b.year).slice(0, 2).map(f => ({ ...f, era: 'then' }));
                const lnow = loc.filter(f => f.year && f.year >= 2000).slice(0, 1).map(f => ({ ...f, era: 'now' }));
                if (!picks.some(p => p.era === 'then')) picks = [...lthen, ...picks];
                if (!picks.some(p => p.era === 'now')) picks = [...picks, ...lnow];
            }
            picks = picks.filter(p => !haveEras.has(p.era));
            for (const f of picks) {
                try { await storePhoto(id, f, order++, uid); report.photos++; }
                catch (e) { report.errors.push(`${site.name} photo ${f.title}: ${e.message}`); }
                await sleep(400);
            }
            log(`+ ${site.type} ${site.name} (${site.state}) photos=${picks.length} then=${picks.filter(p => p.era === 'then').length} MB=${(totalBytes / 1048576).toFixed(1)}`);
        } catch (e) {
            report.errors.push(`${j.kind === 'wiki' ? j.c.wiki : j.a.name}: ${e.message}`);
            log('! error', e.message);
        }
        await sleep(300);
    }
    console.log('REPORT ' + JSON.stringify(report, null, 1));
    await db.end();
})();
