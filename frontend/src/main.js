// Lost Places — John's private nationwide map (RailTeam6, rebuilt 2026-11-20).
// Vanilla JS + MapLibre GL. Every API call needs the owner's token.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const API = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
    del(k) { try { localStorage.removeItem(k); } catch { } },
};

// =============================================================================
// Pin types
// =============================================================================
const TYPES = {
    mine:          { label: 'Mine',                    emoji: '⛏️', color: '#795548', group: 'Places' },
    coal_town:     { label: 'Coal town',               emoji: '🏚️', color: '#37474f', group: 'Places' },
    ghost_town:    { label: 'Ghost town',              emoji: '👻', color: '#c17d11', group: 'Places' },
    iron_furnace:  { label: 'Iron furnace',            emoji: '🔥', color: '#d84315', group: 'Places' },
    lost_building: { label: 'Once a building',         emoji: '🏛️', color: '#7b1fa2', group: 'Places' },
    lost_town:     { label: 'Once a town',             emoji: '🏘️', color: '#00838f', group: 'Places' },
    depot:         { label: 'Depot',                   emoji: '🚉', color: '#1565c0', group: 'Railroad' },
    freight_house: { label: 'Freight house',           emoji: '📦', color: '#1e88e5', group: 'Railroad' },
    bridge:        { label: 'Bridge',                  emoji: '🌉', color: '#0277bd', group: 'Railroad' },
    trestle:       { label: 'Trestle',                 emoji: '🌉', color: '#039be5', group: 'Railroad' },
    tunnel:        { label: 'Tunnel',                  emoji: '🚇', color: '#283593', group: 'Railroad' },
    yard:          { label: 'Rail yard',               emoji: '🛤️', color: '#3949ab', group: 'Railroad' },
    roundhouse:    { label: 'Roundhouse / turntable',  emoji: '🔄', color: '#5c6bc0', group: 'Railroad' },
    water_tower:   { label: 'Water tower',             emoji: '💧', color: '#0097a7', group: 'Railroad' },
    coaling_tower: { label: 'Coaling tower',           emoji: '⚫', color: '#424242', group: 'Railroad' },
    junction:      { label: 'Junction',                emoji: '➕', color: '#546e7a', group: 'Railroad' },
    interlocking:  { label: 'Interlocking tower',      emoji: '🚦', color: '#607d8b', group: 'Railroad' },
    wreck_site:    { label: 'Wreck site',              emoji: '💥', color: '#c62828', group: 'Railroad' },
    other:         { label: 'Other',                   emoji: '📍', color: '#757575', group: 'Other' },
};
const CONDITIONS = {
    preserved:     'Standing / preserved',
    standing_ruin: 'Standing ruin',
    remains:       'Remains only',
    gone:          'Gone (site only)',
    unknown:       'Unknown',
};
const LEGACY_STATUS = { active: 'Still in use', preserved: 'Standing / preserved', abandoned: 'Standing ruin', ruins: 'Remains only',
    destroyed: 'Gone (site only)', relocated: 'Moved elsewhere', unknown: 'Unknown', daylighted_active: 'Daylighted (in use)', daylighted_inactive: 'Daylighted (out of use)' };
const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const typeOf = (t) => TYPES[t] || TYPES.other;

// =============================================================================
// Auth (long-lived token on the device)
// =============================================================================
let token = store.get('lp_token');
let me = store.get('lp_user');

async function api(path, opts = {}) {
    const res = await fetch(API + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
    });
    if (res.status === 401 || res.status === 403) {
        if (!path.startsWith('/api/auth/login')) { signOut(true); throw new Error('Please sign in again'); }
    }
    let data = null;
    try { data = await res.json(); } catch { }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
}

function showLogin(msg = '') {
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('login-error').textContent = msg;
}
function signOut(expired = false) {
    token = null; me = null;
    store.del('lp_token'); store.del('lp_user');
    showLogin(expired ? 'Your session ended. Please sign in again.' : '');
}

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    $('login-error').textContent = '';
    try {
        const d = await api('/api/auth/login', { method: 'POST',
            body: JSON.stringify({ email: $('login-email').value.trim(), password: $('login-password').value }) });
        token = d.token; me = d.user;
        store.set('lp_token', token); store.set('lp_user', me);
        $('login-password').value = '';
        startApp();
    } catch (err) {
        $('login-error').textContent = err.message === 'This map is private.' ? 'This map is private.' : (err.message || 'Sign-in failed');
    } finally {
        btn.disabled = false; btn.textContent = 'Sign in';
    }
});
$('btn-signout').onclick = () => { $('menu').classList.add('hidden'); signOut(); };

// =============================================================================
// Map
// =============================================================================
const US_BOUNDS = [[-125.5, 24.0], [-66.5, 49.6]];
const BASEMAPS = {
    streets: { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors' },
    satellite: { tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16,
        attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank">USGS The National Map</a> (public domain)' },
    topo: { tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16,
        attribution: 'Topo: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank">USGS The National Map</a> (public domain)' },
};
let map = null;
let allFeatures = [];
let enabledTypes = new Set(store.get('lp_types', Object.keys(TYPES)));
let currentId = null;

function buildStyle() {
    const sources = {}, layers = [];
    for (const [k, b] of Object.entries(BASEMAPS)) {
        sources['bm-' + k] = { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
        layers.push({ id: 'bm-' + k, type: 'raster', source: 'bm-' + k, layout: { visibility: 'none' } });
    }
    return { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources, layers };
}

function setBasemap(name) {
    if (!BASEMAPS[name]) name = 'streets';
    for (const k of Object.keys(BASEMAPS)) map.setLayoutProperty('bm-' + k, 'visibility', k === name ? 'visible' : 'none');
    store.set('lp_basemap', name);
    for (const r of document.querySelectorAll('input[name=basemap]')) r.checked = r.value === name;
}

function makeIcon(t) {
    const s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
    g.fillStyle = t.color; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke();
    g.font = '30px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t.emoji, s / 2, s / 2 + 2);
    return g.getImageData(0, 0, s, s);
}

function initMap() {
    const view = store.get('lp_view');
    map = new maplibregl.Map({
        container: 'map', style: buildStyle(), maxZoom: 20, attributionControl: false,
        ...(view ? { center: view.c, zoom: view.z } : { bounds: US_BOUNDS, fitBoundsOptions: { padding: 10 } }),
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    map.on('moveend', () => store.set('lp_view', { c: map.getCenter().toArray(), z: map.getZoom() }));

    map.on('load', async () => {
        setBasemap(store.get('lp_basemap', 'streets'));
        for (const [k, t] of Object.entries(TYPES)) map.addImage('pin-' + k, makeIcon(t), { pixelRatio: 2 });
        map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'lines', type: 'line', source: 'lines', layout: { visibility: 'none' },
            paint: { 'line-color': '#5d4037', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
        map.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'pins', type: 'symbol', source: 'pins',
            layout: {
                'icon-image': ['coalesce', ['image', ['concat', 'pin-', ['get', 'site_type']]], ['image', 'pin-other']],
                'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.55, 8, 0.8, 13, 1],
                'icon-allow-overlap': true, 'icon-ignore-placement': true,
                'symbol-sort-key': ['get', 'sort'],
            },
        });
        map.addLayer({
            id: 'pin-labels', type: 'symbol', source: 'pins', minzoom: 9,
            layout: {
                'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold'], 'text-size': 12,
                'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-max-width': 10, 'text-optional': true,
            },
            paint: { 'text-color': '#1d2320', 'text-halo-color': '#fff', 'text-halo-width': 1.6 },
        });
        if (!store.get('lp_labels', true)) map.setLayoutProperty('pin-labels', 'visibility', 'none');
        map.on('click', 'pins', (e) => { if (!picking && e.features?.[0]) openPin(e.features[0].properties.id); });
        map.on('mouseenter', 'pins', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'pins', () => { map.getCanvas().style.cursor = ''; });
        map.on('click', onMapClickForPick);
        await loadPins();
        const m = location.hash.match(/pin=([0-9a-f-]{36})/);
        if (m) openPin(m[1], true);
        if (store.get('lp_lines', false)) { $('toggle-lines').checked = true; toggleLines(true); }
    });
}

async function loadPins() {
    try {
        const fc = await api('/api/sites');
        allFeatures = fc.features.map(f => ({ ...f, properties: { ...f.properties, sort: f.properties.photos ? 1 : 0 } }));
        applyFilter();
        renderFilterList();
    } catch (err) { toast('Could not load pins: ' + err.message); }
}

function applyFilter() {
    const fc = { type: 'FeatureCollection', features: allFeatures.filter(f => enabledTypes.has(TYPES[f.properties.site_type] ? f.properties.site_type : 'other')) };
    map.getSource('pins')?.setData(fc);
}

function renderFilterList() {
    const counts = {};
    for (const f of allFeatures) { const t = TYPES[f.properties.site_type] ? f.properties.site_type : 'other'; counts[t] = (counts[t] || 0) + 1; }
    let html = '', group = '';
    for (const [k, t] of Object.entries(TYPES)) {
        if (t.group !== group) { group = t.group; html += `<div class="group-title">${group}</div>`; }
        html += `<label><input type="checkbox" data-type="${k}" ${enabledTypes.has(k) ? 'checked' : ''}>
            <span class="swatch" style="background:${t.color}">${t.emoji}</span> ${t.label}<span class="count">${counts[k] || 0}</span></label>`;
    }
    $('filter-list').innerHTML = html;
    for (const cb of $('filter-list').querySelectorAll('input')) cb.onchange = () => {
        cb.checked ? enabledTypes.add(cb.dataset.type) : enabledTypes.delete(cb.dataset.type);
        store.set('lp_types', [...enabledTypes]); applyFilter();
    };
}
$('filter-all').onclick = () => { enabledTypes = new Set(Object.keys(TYPES)); store.set('lp_types', [...enabledTypes]); renderFilterList(); applyFilter(); };
$('filter-none').onclick = () => { enabledTypes = new Set(); store.set('lp_types', []); renderFilterList(); applyFilter(); };

let linesLoaded = false;
async function toggleLines(on) {
    store.set('lp_lines', on);
    if (on && !linesLoaded) {
        try { map.getSource('lines').setData(await api('/api/lines')); linesLoaded = true; } catch (e) { toast(e.message); }
    }
    map.setLayoutProperty('lines', 'visibility', on ? 'visible' : 'none');
}
$('toggle-lines').onchange = (e) => toggleLines(e.target.checked);
$('toggle-labels').checked = store.get('lp_labels', true);
$('toggle-labels').onchange = (e) => { store.set('lp_labels', e.target.checked); map.setLayoutProperty('pin-labels', 'visibility', e.target.checked ? 'visible' : 'none'); };
for (const r of document.querySelectorAll('input[name=basemap]')) r.onchange = () => setBasemap(r.value);

// Panels
function togglePop(id) {
    for (const p of ['layers-panel', 'filter-panel', 'menu']) if (p !== id) $(p).classList.add('hidden');
    $(id).classList.toggle('hidden');
}
$('btn-layers').onclick = () => togglePop('layers-panel');
$('btn-filter').onclick = () => togglePop('filter-panel');
$('btn-menu').onclick = () => togglePop('menu');

let meMarker = null;
function locateMe(cb) {
    if (!navigator.geolocation) return toast('This device has no location');
    toast('Finding your location…');
    navigator.geolocation.getCurrentPosition((pos) => {
        const ll = [pos.coords.longitude, pos.coords.latitude];
        if (cb) return cb(ll, pos.coords.accuracy);
        if (!meMarker) {
            const el = document.createElement('div');
            el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 2px rgba(26,115,232,.35)';
            meMarker = new maplibregl.Marker({ element: el });
        }
        meMarker.setLngLat(ll).addTo(map);
        map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 14) });
        hideToast();
    }, (err) => toast('Location failed: ' + err.message), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}
$('btn-locate').onclick = () => locateMe();

// =============================================================================
// Search: pins first, then towns/places (OpenStreetMap Nominatim, US only)
// =============================================================================
let searchTimer = null;
$('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = $('search').value.trim();
    if (q.length < 2) return $('search-results').classList.add('hidden');
    searchTimer = setTimeout(() => doSearch(q), 300);
});
$('search').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('search-results').classList.add('hidden'); });
async function doSearch(q) {
    const ql = q.toLowerCase();
    const pins = allFeatures.filter(f => (f.properties.name || '').toLowerCase().includes(ql)
        || (f.properties.city || '').toLowerCase().includes(ql)).slice(0, 8);
    let places = [];
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*$/);
    if (m) places = [{ name: `Go to ${m[1]}, ${m[2]}`, ll: [+m[2], +m[1]] }];
    else if (q.length >= 3) {
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=${encodeURIComponent(q)}`);
            places = (await r.json()).map(p => ({ name: p.display_name, ll: [+p.lon, +p.lat] }));
        } catch { }
    }
    const box = $('search-results');
    box.innerHTML = pins.map(f => `<button data-pin="${f.properties.id}">${typeOf(f.properties.site_type).emoji} <b>${esc(f.properties.name)}</b>
        <span class="muted small">${esc([f.properties.city, f.properties.state].filter(Boolean).join(', '))}</span></button>`).join('')
        + places.map((p, i) => `<button data-place="${i}">🔎 ${esc(p.name)}</button>`).join('')
        || '<div style="padding:12px" class="muted">Nothing found</div>';
    box.classList.remove('hidden');
    for (const b of box.querySelectorAll('button')) b.onclick = () => {
        box.classList.add('hidden');
        if (b.dataset.pin) openPin(b.dataset.pin, true);
        else map.flyTo({ center: places[+b.dataset.place].ll, zoom: 13 });
    };
}

// =============================================================================
// Pin page
// =============================================================================
function openSheet(html, formMode = false) {
    $('sheet-body').innerHTML = html;
    $('sheet').classList.toggle('form-mode', formMode);
    $('sheet').classList.remove('hidden');
    $('sheet').scrollTop = 0;
    for (const p of ['layers-panel', 'filter-panel', 'menu']) $(p).classList.add('hidden');
}
function closeSheet() {
    $('sheet').classList.add('hidden');
    currentId = null;
    if (location.hash) history.replaceState(null, '', location.pathname);
    if (draftMarker) { draftMarker.remove(); draftMarker = null; }
}
$('sheet-close').onclick = closeSheet;

async function openPin(id, fly = false) {
    currentId = id;
    openSheet('<p class="muted">Loading…</p>');
    try {
        const s = await api('/api/sites/' + id);
        if (currentId !== id) return;
        history.replaceState(null, '', '#pin=' + id);
        renderPin(s);
        if (fly) map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 12) });
    } catch (err) { openSheet(`<p class="error">${esc(err.message)}</p>`); }
}

function yearsHtml(s) {
    const cells = [['Built / opened', s.built_year], ['Closed / abandoned', s.closed_year], ['Demolished', s.demolished_year]];
    return `<div class="years">${cells.map(([l, v]) => `<div><b>${v ?? '?'}</b><span>${l}</span></div>`).join('')}</div>`;
}

function photoCredit(p) {
    const bits = [];
    if (p.credit) bits.push(esc(p.credit));
    if (p.license) bits.push(esc(p.license));
    if (p.source_url) bits.push(`<a href="${esc(p.source_url)}" target="_blank" rel="noopener">source</a>`);
    return bits.join(' · ');
}

function eraCol(era, photos) {
    const label = era === 'then' ? 'Then' : 'Now';
    if (!photos.length) return `<div class="era-col ${era}"><h4>${label}</h4><div class="empty">No ${label.toLowerCase()} photo yet</div></div>`;
    const [first, ...rest] = photos;
    return `<div class="era-col ${era}"><h4>${label}</h4>
        <button class="ph" data-ph="${first.id}"><img loading="lazy" src="${esc(first.thumb_url || first.url)}" alt="${esc(first.caption || label)}">
            ${first.year ? `<span class="yr">${first.year}</span>` : ''}</button>
        <div class="photo-credit">${esc(first.caption || '')}${first.caption ? '<br>' : ''}${photoCredit(first)}</div>
        ${rest.length ? `<div class="more">${rest.map(p => `<button class="ph" data-ph="${p.id}"><img loading="lazy" src="${esc(p.thumb_url || p.url)}" alt=""></button>`).join('')}</div>` : ''}
    </div>`;
}

function renderPin(s) {
    const t = typeOf(s.site_type);
    const place = [s.city, s.county ? `${s.county}${/county|parish|borough/i.test(s.county) ? '' : ' County'}` : null, s.state_province].filter(Boolean).join(', ');
    const cond = s.condition ? CONDITIONS[s.condition] : LEGACY_STATUS[s.status];
    const lat = (+s.lat).toFixed(6), lng = (+s.lng).toFixed(6);
    const then = s.photos.filter(p => p.era === 'then'), now = s.photos.filter(p => p.era !== 'then');
    const history = (s.description || '').split(/\n\s*\n|\r\n\s*\r\n/).map(x => x.trim()).filter(Boolean);
    openSheet(`
        <span class="type-badge" style="background:${t.color}"><span class="e">${t.emoji}</span>${esc(t.label)}</span>
        <h2>${esc(s.name)}</h2>
        <p class="place">${esc(place || 'Location not named yet')}</p>
        <div class="chips">
            ${cond ? `<span class="chip">${esc(cond)}</span>` : ''}
            ${s.is_private_land ? '<span class="chip priv">🚫 Private land</span>' : ''}
            ${s.is_dangerous ? '<span class="chip warn">⚠️ Dangerous</span>' : ''}
            ${s.coords_approx ? '<span class="chip priv">📍 Approximate spot</span>' : ''}
            ${s.railroads?.length ? `<span class="chip">🚂 ${esc(s.railroads.join(', '))}</span>` : ''}
        </div>
        ${yearsHtml(s)}
        <div class="thennow">${eraCol('then', then)}${eraCol('now', now)}</div>
        ${history.length ? `<div class="section-title">History</div><div class="history">${history.map(p => `<p>${esc(p)}</p>`).join('')}</div>` : '<p class="muted">No history written yet.</p>'}
        ${s.history_credit ? `<div class="credit-line">${esc(s.history_credit)}</div>` : ''}
        ${s.sources?.length ? `<div class="section-title">Sources</div><ol class="sources">${s.sources.map(x =>
            `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.citation || x.url)}</a>` : esc(x.citation)}</li>`).join('')}</ol>` : ''}
        <div class="section-title">GPS</div>
        <div class="gps"><code id="gps-text">${lat}, ${lng}</code>
            <button class="btn" id="btn-copy">Copy</button>
            <a class="btn btn-primary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}">Directions</a></div>
        ${s.coords_approx ? `<div class="approx-note">📍 <b>Approximate location.</b> ${esc(s.coords_note || 'The exact spot is not confirmed; check on the ground before you go.')}</div>` : ''}
        <div class="actions">
            <button class="btn" id="btn-edit">✏️ Edit</button>
            <button class="btn btn-danger" id="btn-delete">🗑️ Delete</button>
        </div>`);
    $('btn-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(`${lat}, ${lng}`); toast('GPS copied'); }
        catch { const r = document.createRange(); r.selectNode($('gps-text')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Press copy'); }
    };
    $('btn-edit').onclick = () => openForm(s);
    $('btn-delete').onclick = async () => {
        if (!confirm(`Delete "${s.name}" from the map?`)) return;
        try { await api('/api/sites/' + s.id, { method: 'DELETE' }); toast('Pin deleted'); closeSheet(); loadPins(); }
        catch (e) { toast(e.message); }
    };
    for (const b of $('sheet-body').querySelectorAll('[data-ph]')) b.onclick = () => openLightbox(s.photos.find(p => p.id === b.dataset.ph));
}

function openLightbox(p) {
    if (!p) return;
    $('lb-img').src = p.url;
    $('lb-cap').innerHTML = [p.era === 'then' ? 'THEN' : 'NOW', p.year, esc(p.caption || '')].filter(Boolean).join(' · ')
        + (photoCredit(p) ? '<br>' + photoCredit(p) : '');
    $('lightbox').classList.remove('hidden');
}
$('lb-close').onclick = () => { $('lightbox').classList.add('hidden'); $('lb-img').src = ''; };
$('lightbox').onclick = (e) => { if (e.target === $('lightbox')) $('lb-close').onclick(); };

// =============================================================================
// Add / edit pin
// =============================================================================
let picking = false, draftMarker = null, draftLL = null, editing = null;
let pendingPhotos = [], removePhotoIds = [];

function startPick() {
    closeSheet();
    picking = true; editing = null;
    $('pick-banner').classList.remove('hidden');
    $('btn-add').classList.add('hidden');
    map.getCanvas().style.cursor = 'crosshair';
}
function endPick() {
    picking = false;
    $('pick-banner').classList.add('hidden');
    $('btn-add').classList.remove('hidden');
    map.getCanvas().style.cursor = '';
}
$('btn-add').onclick = startPick;
$('pick-cancel').onclick = () => { endPick(); if (draftMarker) { draftMarker.remove(); draftMarker = null; } };
$('pick-gps').onclick = () => locateMe((ll, acc) => {
    map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 16) });
    placeDraft(ll, acc);
});
function onMapClickForPick(e) { if (picking) placeDraft([e.lngLat.lng, e.lngLat.lat]); }

function placeDraft(ll, accuracy) {
    endPick();
    draftLL = ll;
    if (!draftMarker) {
        draftMarker = new maplibregl.Marker({ color: '#b5521b', draggable: true });
        draftMarker.on('dragend', () => { const p = draftMarker.getLngLat(); draftLL = [p.lng, p.lat]; updateCoordBox(); });
    }
    draftMarker.setLngLat(ll).addTo(map);
    if (!$('pin-form')) openForm(null, accuracy);
    else updateCoordBox();
    // keep the pin visible above the sheet on phones
    if (innerWidth < 900) map.easeTo({ center: ll, offset: [0, -innerHeight * 0.3] });
}

function updateCoordBox() {
    const el = $('coord-box');
    if (el && draftLL) el.innerHTML = `📍 <b>${draftLL[1].toFixed(6)}, ${draftLL[0].toFixed(6)}</b><br><span class="muted">Drag the orange pin to fine-tune, or <button type="button" class="link" id="btn-repick">tap a new spot</button>.</span>`;
    const rp = $('btn-repick');
    if (rp) rp.onclick = () => { picking = true; $('pick-banner').classList.remove('hidden'); $('pick-text').textContent = 'Tap the new spot'; };
}

function typeOptions(sel) {
    let html = '', group = '';
    for (const [k, t] of Object.entries(TYPES)) {
        if (t.group !== group) { if (group) html += '</optgroup>'; group = t.group; html += `<optgroup label="${group}">`; }
        html += `<option value="${k}" ${k === sel ? 'selected' : ''}>${t.emoji} ${t.label}</option>`;
    }
    return html + '</optgroup>';
}

function openForm(site, accuracy) {
    editing = site;
    pendingPhotos = []; removePhotoIds = [];
    if (site) {
        draftLL = [+site.lng, +site.lat];
        if (!draftMarker) {
            draftMarker = new maplibregl.Marker({ color: '#b5521b', draggable: true });
            draftMarker.on('dragend', () => { const p = draftMarker.getLngLat(); draftLL = [p.lng, p.lat]; updateCoordBox(); });
        }
        draftMarker.setLngLat(draftLL).addTo(map);
    }
    const s = site || {};
    const v = (x) => esc(x ?? '');
    const srcs = s.sources?.length ? s.sources : [{}];
    openSheet(`<form id="pin-form" class="form" autocomplete="off">
        <h2>${site ? 'Edit pin' : 'New pin'}</h2>
        <div id="coord-box" class="coord-box"></div>
        ${accuracy ? `<div class="muted small">Phone location accurate to about ${Math.round(accuracy * 3.28)} ft.</div>` : ''}
        <label>Name *<input type="text" name="name" required value="${v(s.name)}" placeholder="e.g. Buffalo Furnace"></label>
        <label>What is it? *<select name="site_type" required>${typeOptions(s.site_type || 'iron_furnace')}</select></label>
        <div class="row3">
            <label>Town<input type="text" name="city" value="${v(s.city)}"></label>
            <label>County<input type="text" name="county" value="${v(s.county)}"></label>
            <label>State<select name="state"><option value=""></option>${STATES.map(x => `<option ${x === s.state_province ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        </div>
        <div class="row3">
            <label>Built / opened<input type="number" name="built_year" inputmode="numeric" value="${v(s.built_year)}"></label>
            <label>Closed<input type="number" name="closed_year" inputmode="numeric" value="${v(s.closed_year)}"></label>
            <label>Demolished<input type="number" name="demolished_year" inputmode="numeric" value="${v(s.demolished_year)}"></label>
        </div>
        <label>What's there now?<select name="condition">${Object.entries(CONDITIONS).map(([k, l]) =>
            `<option value="${k}" ${k === (s.condition || 'unknown') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="checks">
            <label><input type="checkbox" name="is_private_land" ${s.is_private_land ? 'checked' : ''}> 🚫 Private land</label>
            <label><input type="checkbox" name="is_dangerous" ${s.is_dangerous ? 'checked' : ''}> ⚠️ Dangerous</label>
            <label><input type="checkbox" name="coords_approx" ${s.coords_approx ? 'checked' : ''}> 📍 Spot is approximate</label>
        </div>
        <label>History<textarea name="description" placeholder="What it was, who ran it, when it closed. Blank line = new paragraph.">${v(s.description)}</textarea></label>

        <div class="section-title">Photos</div>
        ${site?.photos?.length ? `<div id="existing-photos">${site.photos.map(p => `<div class="pending" data-existing="${p.id}">
            <img src="${esc(p.thumb_url || p.url)}" alt=""><div class="meta"><b>${p.era === 'then' ? 'Then' : 'Now'}</b><span class="small muted">${esc(p.caption || '')}</span></div>
            <button type="button" class="x" data-remove="${p.id}" title="Remove">✕</button></div>`).join('')}</div>` : ''}
        <div class="photo-pick then"><h4>Then (old photos)</h4>
            <label class="btn file-label">📁 Add old photo<input type="file" accept="image/*" multiple data-era="then"></label>
            <div id="pend-then"></div></div>
        <div class="photo-pick now"><h4>Now (today)</h4>
            <label class="btn file-label">📷 Take photo<input type="file" accept="image/*" capture="environment" data-era="now"></label>
            <label class="btn file-label">📁 From files<input type="file" accept="image/*" multiple data-era="now"></label>
            <div id="pend-now"></div></div>

        <div class="section-title">Sources</div>
        <div id="src-rows">${srcs.map(x => srcRow(x)).join('')}</div>
        <button type="button" class="link" id="add-src" style="margin-top:8px">＋ Add source</button>

        <button type="submit" class="btn btn-primary btn-big" id="save-btn">${site ? 'Save changes' : 'Save pin'}</button>
        <p id="form-error" class="error"></p>
    </form>`, true);
    updateCoordBox();
    const f = $('pin-form');
    for (const inp of f.querySelectorAll('input[type=file]')) inp.onchange = () => { addPending([...inp.files], inp.dataset.era); inp.value = ''; };
    for (const b of f.querySelectorAll('[data-remove]')) b.onclick = () => { removePhotoIds.push(b.dataset.remove); b.closest('.pending').remove(); };
    $('add-src').onclick = () => { $('src-rows').insertAdjacentHTML('beforeend', srcRow({})); wireSrcRows(); };
    wireSrcRows();
    f.onsubmit = (e) => { e.preventDefault(); savePin(); };
}

function srcRow(x) {
    return `<div class="src-row"><input type="text" placeholder="Title" data-src="t" value="${esc(x.citation || '')}">
        <input type="url" placeholder="https://…" data-src="u" value="${esc(x.url || '')}"><button type="button" class="x" data-delsrc>✕</button></div>`;
}
function wireSrcRows() { for (const b of document.querySelectorAll('[data-delsrc]')) b.onclick = () => b.closest('.src-row').remove(); }

function addPending(files, era) {
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const p = { file, era, key: Math.random().toString(36).slice(2), preview: URL.createObjectURL(file) };
        pendingPhotos.push(p);
        $('pend-' + era).insertAdjacentHTML('beforeend', `<div class="pending" data-key="${p.key}">
            <img src="${p.preview}" alt=""><div class="meta">
            <input type="text" placeholder="Caption" data-f="caption">
            <div class="row"><input type="number" inputmode="numeric" placeholder="Year" data-f="year" ${era === 'now' ? `value="${new Date().getFullYear()}"` : ''}>
            <input type="text" placeholder="Credit" data-f="credit"></div>
            ${era === 'then' ? '<input type="url" placeholder="Where it came from (link)" data-f="source_url">' : ''}
            </div><button type="button" class="x" title="Remove">✕</button></div>`);
        const row = document.querySelector(`[data-key="${p.key}"]`);
        row.querySelector('.x').onclick = () => { pendingPhotos = pendingPhotos.filter(x => x !== p); row.remove(); };
    }
}

async function resizeImage(file, maxDim, quality) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', quality));
    if (!blob) throw new Error('Could not read that photo');
    return { blob, w, h };
}
const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

async function uploadOne(p) {
    const [full, thumb] = await Promise.all([resizeImage(p.file, 1600, 0.82), resizeImage(p.file, 480, 0.75)]);
    const d = await api('/api/upload/photo', { method: 'POST', body: JSON.stringify({ full: await toB64(full.blob), thumb: await toB64(thumb.blob) }) });
    const row = document.querySelector(`[data-key="${p.key}"]`);
    const get = (k) => row?.querySelector(`[data-f="${k}"]`)?.value?.trim() || null;
    return { era: p.era, storage_path: d.storage_path, thumb_path: d.thumb_path, bytes: d.bytes, width: full.w, height: full.h,
        caption: get('caption'), year: get('year'), credit: get('credit'), source_url: get('source_url') };
}

async function savePin() {
    const f = $('pin-form'), btn = $('save-btn');
    if (!draftLL) { $('form-error').textContent = 'Tap the map to place the pin first.'; return; }
    const fd = new FormData(f);
    const body = Object.fromEntries(['name', 'site_type', 'city', 'county', 'state', 'built_year', 'closed_year', 'demolished_year', 'condition', 'description'].map(k => [k, fd.get(k)]));
    for (const k of ['is_private_land', 'is_dangerous', 'coords_approx']) body[k] = fd.get(k) === 'on';
    body.lng = draftLL[0]; body.lat = draftLL[1];
    body.sources = [...document.querySelectorAll('.src-row')].map(r => ({ citation: r.querySelector('[data-src=t]').value.trim(), url: r.querySelector('[data-src=u]').value.trim() }))
        .filter(x => x.citation || x.url);
    if (editing?.coords_note) body.coords_note = editing.coords_note;
    btn.disabled = true; $('form-error').textContent = '';
    try {
        body.photos = [];
        for (let i = 0; i < pendingPhotos.length; i++) {
            btn.textContent = `Uploading photo ${i + 1} of ${pendingPhotos.length}…`;
            body.photos.push(await uploadOne(pendingPhotos[i]));
        }
        btn.textContent = 'Saving…';
        body.remove_photo_ids = removePhotoIds;
        const saved = editing
            ? await api('/api/sites/' + editing.id, { method: 'PATCH', body: JSON.stringify(body) })
            : await api('/api/sites', { method: 'POST', body: JSON.stringify(body) });
        if (draftMarker) { draftMarker.remove(); draftMarker = null; }
        draftLL = null; pendingPhotos = [];
        toast(editing ? 'Saved' : 'Pin added');
        editing = null;
        await loadPins();
        currentId = saved.id; history.replaceState(null, '', '#pin=' + saved.id);
        renderPin(saved);
    } catch (err) {
        $('form-error').textContent = err.message;
    } finally {
        btn.disabled = false; btn.textContent = editing ? 'Save changes' : 'Save pin';
    }
}

// =============================================================================
// Toast + start
// =============================================================================
let toastTimer = null;
function toast(msg) { $('toast').textContent = msg; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 3500); }
function hideToast() { $('toast').classList.add('hidden'); }

async function startApp() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('menu-user').textContent = me?.email ? 'Signed in as ' + me.email : '';
    if (!map) initMap(); else loadPins();
}

(async function boot() {
    if (!token) return showLogin();
    try { me = await api('/api/auth/me'); store.set('lp_user', me); startApp(); }
    catch (e) { if (token) { startApp(); } } // offline/cold start: keep going with the saved token
})();
