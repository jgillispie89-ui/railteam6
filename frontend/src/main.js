import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001';

// =============================================================================
// Map init
// =============================================================================
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors',
            },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
    center: [-84.33, 38.68],
    zoom: 8,
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// =============================================================================
// Auth state
// =============================================================================
const auth = {
    token: localStorage.getItem('ir_token') || null,
    user:  JSON.parse(localStorage.getItem('ir_user') || 'null'),
};

function saveAuth(token, user) {
    auth.token = token;
    auth.user  = user;
    localStorage.setItem('ir_token', token);
    localStorage.setItem('ir_user', JSON.stringify(user));
    renderNav();
}

function clearAuth() {
    auth.token = null;
    auth.user  = null;
    localStorage.removeItem('ir_token');
    localStorage.removeItem('ir_user');
    renderNav();
}

function authedFetch(url, opts = {}) {
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    if (auth.token) opts.headers['Authorization'] = `Bearer ${auth.token}`;
    return fetch(url, opts);
}

function renderNav() {
    const nav = document.getElementById('nav-auth');
    if (!nav) return;
    if (auth.user) {
        const unverifiedBtn = !auth.user.verified
            ? `<button class="nav-btn unverified-btn" id="btn-resend-nav" title="Verify your email to contribute — click to resend">⚠ Unverified</button>`
            : '';
        nav.innerHTML = `
            ${unverifiedBtn}
            <span class="nav-user">${esc(auth.user.email)}</span>
            ${auth.user.role === 'admin' ? '<button class="nav-btn" id="btn-admin">Admin</button>' : ''}
            <button class="nav-btn" id="btn-logout">Logout</button>
        `;
        document.getElementById('btn-resend-nav')?.addEventListener('click', resendVerification);
        document.getElementById('btn-logout')?.addEventListener('click', clearAuth);
        document.getElementById('btn-admin')?.addEventListener('click', openAdminPanel);
    } else {
        nav.innerHTML = `<button class="nav-btn" id="btn-login">Login / Register</button>`;
        document.getElementById('btn-login')?.addEventListener('click', () => openAuthModal('login'));
    }
}

// =============================================================================
// Auth modal — single form, login/register modes
// =============================================================================
let authMode = 'login';

function openAuthModal(mode = 'login') {
    document.getElementById('auth-modal').classList.remove('hidden');
    setAuthMode(mode);
    setTimeout(() => document.getElementById('auth-email')?.focus(), 50);
}

function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('auth-msg').textContent = '';
    document.getElementById('auth-email').value    = '';
    document.getElementById('auth-password').value = '';
}

function setAuthMode(mode) {
    authMode = mode;
    const isLogin = mode === 'login';
    document.getElementById('auth-title').textContent          = isLogin ? 'Log in' : 'Create account';
    document.getElementById('auth-submit-btn').textContent     = isLogin ? 'Log in' : 'Create account';
    document.getElementById('auth-pw-hint').classList.toggle('hidden', isLogin);
    document.getElementById('auth-toggle-prompt').textContent  = isLogin ? "Don't have an account?" : 'Already have an account?';
    document.getElementById('auth-toggle-link').textContent    = isLogin ? ' Sign up' : ' Log in';
    document.getElementById('auth-msg').textContent            = '';
}

document.getElementById('auth-close').addEventListener('click', closeAuthModal);

document.getElementById('auth-toggle-link').addEventListener('click', e => {
    e.preventDefault();
    setAuthMode(authMode === 'login' ? 'register' : 'login');
});

document.getElementById('auth-submit-btn').addEventListener('click', async () => {
    const msg      = document.getElementById('auth-msg');
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    msg.className  = 'form-status';

    if (authMode === 'login') {
        try {
            const res  = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            saveAuth(data.token, data.user);
            closeAuthModal();
        } catch (err) {
            msg.textContent = '✕ ' + err.message;
            msg.className   = 'form-status err';
        }
    } else {
        try {
            const res  = await fetch(`${API_BASE}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            saveAuth(data.token, data.user);
            msg.textContent = '✓ Account created! Check your email to verify your address.';
            msg.className   = 'form-status ok';
            setTimeout(closeAuthModal, 3000);
        } catch (err) {
            msg.textContent = '✕ ' + err.message;
            msg.className   = 'form-status err';
        }
    }
});

// Enter key submits the form
document.getElementById('auth-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('auth-submit-btn').click();
});

// =============================================================================
// Email verification (/verify?token=XXX in URL)
// =============================================================================
async function handleVerifyEmail() {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');
    if (!token) return;
    try {
        const res  = await fetch(`${API_BASE}/api/auth/verify?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok) {
            if (data.token && auth.user) {
                saveAuth(data.token, { ...auth.user, verified: true });
            }
            showBanner('✓ Email verified — you can now contribute!', 'ok');
        } else {
            showBanner('✕ ' + data.error, 'err');
        }
    } catch {
        showBanner('✕ Verification failed. Try again.', 'err');
    }
    window.history.replaceState({}, '', '/');
}

async function resendVerification() {
    try {
        const res  = await authedFetch(`${API_BASE}/api/auth/resend-verification`, { method: 'POST', body: '{}' });
        const data = await res.json();
        if (res.ok) {
            showBanner('✓ Verification email sent — check your inbox.', 'ok');
        } else {
            showBanner('✕ ' + data.error, 'err');
        }
    } catch {
        showBanner('✕ Could not send email. Try again later.', 'err');
    }
}

function showBanner(msg, type) {
    const b = document.getElementById('site-banner');
    b.textContent = msg;
    b.className   = 'site-banner ' + type;
    b.classList.remove('hidden');
    setTimeout(() => b.classList.add('hidden'), 6000);
}

// =============================================================================
// Admin panel
// =============================================================================
async function openAdminPanel() {
    document.getElementById('admin-modal').classList.remove('hidden');
    await refreshAdminQueue();
}

async function refreshAdminQueue() {
    const list = document.getElementById('admin-queue');
    list.innerHTML = '<p class="hint">Loading...</p>';
    try {
        const res  = await authedFetch(`${API_BASE}/api/admin/queue`);
        const rows = await res.json();
        if (!rows.length) { list.innerHTML = '<p class="hint">No pending submissions.</p>'; return; }
        list.innerHTML = rows.map(s => `
            <div class="queue-item" data-id="${s.id}">
                <div class="queue-name">${esc(s.name)}</div>
                <div class="queue-meta">${esc(prettyType(s.site_type))} · ${esc(s.city || '')}${s.state_province ? ', ' + esc(s.state_province) : ''} · by ${esc(s.submitted_by || 'unknown')}</div>
                ${s.description ? `<div class="queue-desc">${esc(s.description)}</div>` : ''}
                <div class="queue-actions">
                    <button class="btn-approve" data-id="${s.id}">✓ Approve</button>
                    <button class="btn-reject"  data-id="${s.id}">✕ Reject</button>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('.btn-approve').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/approve/${btn.dataset.id}`, { method: 'POST', body: '{}' });
                await refreshAdminQueue();
                await loadData();
            })
        );
        list.querySelectorAll('.btn-reject').forEach(btn =>
            btn.addEventListener('click', async () => {
                await authedFetch(`${API_BASE}/api/admin/reject/${btn.dataset.id}`, { method: 'POST', body: '{}' });
                await refreshAdminQueue();
            })
        );
    } catch (err) {
        list.innerHTML = `<p class="form-status err">${esc(err.message)}</p>`;
    }
}

document.getElementById('admin-close').addEventListener('click', () => {
    document.getElementById('admin-modal').classList.add('hidden');
});

// =============================================================================
// State
// =============================================================================
const state = {
    year: 2026,
    lineStatuses: new Set(['active', 'abandoned', 'destroyed', 'rail_trail']),
    siteTypes: new Set(['depot','freight_house','bridge','trestle','tunnel','yard','roundhouse']),
    siteStatuses: new Set(['active','preserved','abandoned','ruins','destroyed','daylighted_active','daylighted_inactive']),
    overlayOpacity: 0,
    historicMaps: [],
    activeMapId: null,
    pinMode: false,
    pendingPinLngLat: null,
};

// =============================================================================
// Historic map management
// =============================================================================
async function loadHistoricMaps() {
    try {
        const res = await fetch(`${API_BASE}/api/historic-maps`);
        state.historicMaps = await res.json();
        renderMapLibrary();
        updateOverlayForYear(state.year);
    } catch (_) {}
}

function renderMapLibrary() {
    const list = document.getElementById('map-library-list');
    if (!state.historicMaps.length) {
        list.innerHTML = '<p class="hint">No historic maps loaded yet. Click + Add to add one.</p>';
        return;
    }
    list.innerHTML = state.historicMaps.map(m => `
        <div class="map-lib-item ${m.id === state.activeMapId ? 'active-map' : ''}" data-id="${m.id}">
            <span class="map-year">${m.published_year}</span>${m.title}
        </div>
    `).join('');
    list.querySelectorAll('.map-lib-item').forEach(el => {
        el.addEventListener('click', () => activateMap(el.dataset.id));
    });
}

function activateMap(id) {
    const m = state.historicMaps.find(x => x.id === id);
    if (!m) return;
    state.activeMapId = id;
    const opacity = state.overlayOpacity / 100;
    if (map.getSource('historic-overlay')) {
        map.getSource('historic-overlay').setTiles([m.tile_url]);
        map.setPaintProperty('historic-overlay', 'raster-opacity', opacity);
    } else {
        map.addSource('historic-overlay', { type: 'raster', tiles: [m.tile_url], tileSize: 256, attribution: m.title });
        map.addLayer({ id: 'historic-overlay', type: 'raster', source: 'historic-overlay', paint: { 'raster-opacity': opacity } }, 'lines-layer');
    }
    document.getElementById('overlay-hint').textContent = `Showing: ${m.title} (${m.published_year})`;
    renderMapLibrary();
}

function updateOverlayForYear(year) {
    if (!state.historicMaps.length) return;
    const closest = state.historicMaps.reduce((best, m) =>
        Math.abs(m.published_year - year) < Math.abs(best.published_year - year) ? m : best
    );
    if (closest.id !== state.activeMapId) activateMap(closest.id);
}

// =============================================================================
// Pin drop (Add Site)
// =============================================================================
function enterPinMode() {
    state.pinMode = true;
    document.getElementById('btn-drop-pin').classList.add('active');
    map.getCanvas().style.cursor = 'crosshair';
    map.once('click', onPinDrop);
}

function exitPinMode() {
    state.pinMode = false;
    document.getElementById('btn-drop-pin').classList.remove('active');
    map.getCanvas().style.cursor = '';
    map.off('click', onPinDrop);
}

function onPinDrop(e) {
    const { lng, lat } = e.lngLat;
    state.pendingPinLngLat = [lng, lat];
    exitPinMode();
    openSiteForm();
}

document.getElementById('btn-drop-pin').addEventListener('click', () => {
    if (state.pinMode) { exitPinMode(); return; }
    if (!auth.token) { openAuthModal('login'); return; }
    if (!auth.user?.verified) {
        showBanner('Verify your email to contribute — check your inbox, or click ⚠ Unverified to resend.', 'err');
        return;
    }
    enterPinMode();
});

// =============================================================================
// Site submission form — photo upload
// =============================================================================
let sfPhotos = []; // [{url, thumb_url}]

function setDropZoneIdle() {
    document.getElementById('sf-photo-preview').innerHTML =
        `<span>📷 ${sfPhotos.length > 0 ? 'Add another image' : 'Drop images here, or click to browse'}</span>`;
    document.getElementById('sf-photo-drop').classList.remove('drag-over', 'has-photo');
    setOverlayActive(true);
}

function resetPhotoState() {
    sfPhotos = [];
    renderPhotoGrid();
    setDropZoneIdle();
    document.getElementById('sf-photo-progress').classList.add('hidden');
    document.getElementById('sf-photo-bar').style.width = '0';
    document.getElementById('sf-photo-url-row').classList.add('hidden');
    const urlInput = document.getElementById('sf-photo-url');
    if (urlInput) urlInput.value = '';
    document.getElementById('sf-photo-file').value = '';
}

function renderPhotoGrid() {
    const grid = document.getElementById('sf-photo-grid');
    if (!grid) return;
    if (sfPhotos.length === 0) { grid.innerHTML = ''; return; }
    grid.innerHTML = sfPhotos.map((p, i) => `
        <div class="photo-grid-item">
            <img src="${esc(p.thumb_url || p.url)}" alt="Photo ${i + 1}">
            <button type="button" class="photo-grid-remove" data-idx="${i}" title="Remove">×</button>
        </div>
    `).join('');
    grid.querySelectorAll('.photo-grid-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            sfPhotos.splice(parseInt(btn.dataset.idx), 1);
            renderPhotoGrid();
            setDropZoneIdle();
        });
    });
}

async function handlePhotoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        document.getElementById('sf-photo-preview').innerHTML =
            `<span class="photo-err">✕ Not an image — please pick a jpg, png, or webp.</span>`;
        return;
    }
    if (sfPhotos.length >= 10) {
        document.getElementById('sf-photo-preview').innerHTML =
            `<span class="photo-err">Maximum 10 photos per site.</span>`;
        return;
    }
    const preview  = document.getElementById('sf-photo-preview');
    const progress = document.getElementById('sf-photo-progress');
    const bar      = document.getElementById('sf-photo-bar');
    setOverlayActive(false);
    progress.classList.remove('hidden');
    bar.style.width = '15%';
    preview.innerHTML = `<span class="photo-uploading">⏳ Uploading…</span>`;
    try {
        const form = new FormData();
        form.append('photo', file);
        bar.style.width = '50%';
        const res  = await fetch(`${API_BASE}/api/upload/photo`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${auth.token}` },
            body: form,
        });
        bar.style.width = '90%';
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        bar.style.width = '100%';
        sfPhotos.push({ url: data.url, thumb_url: data.thumb_url });
        renderPhotoGrid();
        setTimeout(() => {
            progress.classList.add('hidden');
            bar.style.width = '0';
            document.getElementById('sf-photo-file').value = '';
            setDropZoneIdle();
        }, 400);
    } catch (err) {
        progress.classList.add('hidden');
        bar.style.width = '0';
        preview.innerHTML = `<span class="photo-err">✕ ${esc(err.message)} — try again</span>`;
        setOverlayActive(true);
    }
}

// Drop zone — the file input is a full-size transparent overlay so clicks hit it naturally.
// We only need to handle drag-and-drop and the change event here.
const sfDropZone = document.getElementById('sf-photo-drop');
const sfFileInput = document.getElementById('sf-photo-file');

// When a photo is already uploaded, hide the overlay so Remove/Retry buttons are clickable.
function setOverlayActive(active) {
    sfFileInput.style.pointerEvents = active ? 'auto' : 'none';
    sfFileInput.style.zIndex = active ? '1' : '-1';
}

sfDropZone.addEventListener('dragenter', e => {
    e.preventDefault();
    sfDropZone.classList.add('drag-over');
});
sfDropZone.addEventListener('dragover', e => {
    e.preventDefault();
    sfDropZone.classList.add('drag-over');
});
sfDropZone.addEventListener('dragleave', e => {
    if (!sfDropZone.contains(e.relatedTarget)) sfDropZone.classList.remove('drag-over');
});
sfDropZone.addEventListener('drop', async e => {
    e.preventDefault();
    sfDropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    for (const file of files.slice(0, 10 - sfPhotos.length)) {
        await handlePhotoFile(file);
    }
});
sfFileInput.addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    for (const file of files.slice(0, 10 - sfPhotos.length)) {
        await handlePhotoFile(file);
    }
});
document.getElementById('sf-photo-url-toggle').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('sf-photo-url-row').classList.toggle('hidden');
});

function openSiteForm() { document.getElementById('site-form').classList.remove('hidden'); }
function closeSiteForm() {
    document.getElementById('site-form').classList.add('hidden');
    document.getElementById('sf-status-msg').textContent = '';
    resetPhotoState();
    state.pendingPinLngLat = null;
}

document.getElementById('sf-cancel').addEventListener('click', closeSiteForm);
document.getElementById('sf-submit').addEventListener('click', async () => {
    const msg = document.getElementById('sf-status-msg');
    const [lng, lat] = state.pendingPinLngLat || [null, null];
    const body = {
        name:           document.getElementById('sf-name').value.trim(),
        site_type:      document.getElementById('sf-type').value,
        status:         document.getElementById('sf-status').value,
        lng, lat,
        city:           document.getElementById('sf-city').value.trim() || null,
        state_province: document.getElementById('sf-state').value.trim().toUpperCase() || null,
        built_year:     parseInt(document.getElementById('sf-built').value) || null,
        closed_year:    parseInt(document.getElementById('sf-closed').value) || null,
        demolished_year: parseInt(document.getElementById('sf-demo').value) || null,
        description:    document.getElementById('sf-desc').value.trim() || null,
        photos:         sfPhotos.length > 0 ? sfPhotos : undefined,
        photo_url:      sfPhotos.length === 0 ? (document.getElementById('sf-photo-url')?.value.trim() || null) : null,
    };
    try {
        const res  = await authedFetch(`${API_BASE}/api/sites`, {
            method: 'POST', body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const live = data.mod_status === 'approved';
        msg.textContent = live
            ? '✓ Published! Your site is now live on the map.'
            : '✓ Submitted for review! It will appear once approved.';
        msg.className   = 'form-status ok';
        if (live) { loadData(); }
        setTimeout(closeSiteForm, 2500);
    } catch (err) {
        msg.textContent = '✕ ' + err.message;
        msg.className   = 'form-status err';
    }
});

// =============================================================================
// Add historic map form
// =============================================================================
document.getElementById('btn-add-map').addEventListener('click', () => {
    if (!auth.token) { openAuthModal('login'); return; }
    document.getElementById('map-form').classList.remove('hidden');
});
document.getElementById('mf-cancel').addEventListener('click', () => {
    document.getElementById('map-form').classList.add('hidden');
});
document.getElementById('mf-submit').addEventListener('click', async () => {
    const msg = document.getElementById('mf-status-msg');
    const body = {
        title:          document.getElementById('mf-title').value.trim(),
        published_year: parseInt(document.getElementById('mf-year').value),
        tile_url:       document.getElementById('mf-url').value.trim(),
        publisher:      document.getElementById('mf-publisher').value.trim() || null,
        source_url:     document.getElementById('mf-source-url').value.trim() || null,
    };
    if (!body.title || !body.published_year || !body.tile_url) {
        msg.textContent = '✕ Title, year, and tile URL are required.';
        msg.className   = 'form-status err';
        return;
    }
    try {
        const res = await authedFetch(`${API_BASE}/api/historic-maps`, {
            method: 'POST', body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        msg.textContent = '✓ Map added!';
        msg.className   = 'form-status ok';
        await loadHistoricMaps();
        setTimeout(() => { document.getElementById('map-form').classList.add('hidden'); }, 1000);
    } catch (err) {
        msg.textContent = '✕ ' + err.message;
        msg.className   = 'form-status err';
    }
});

// =============================================================================
// Data loading
// =============================================================================
async function loadData() {
    try {
        const [sitesRes, linesRes] = await Promise.all([
            fetch(`${API_BASE}/api/sites`),
            fetch(`${API_BASE}/api/lines`),
        ]);
        const sites = await sitesRes.json();
        const lines = await linesRes.json();
        addOrUpdateSource('sites', sites);
        addOrUpdateSource('lines', lines);
        applyFilters();
        maybeHideMapNotice(sites.features?.length ?? 0);
    } catch (err) {
        console.warn('Backend unreachable:', err);
        useFallbackData();
    }
}

function addOrUpdateSource(id, geojson) {
    if (map.getSource(id)) map.getSource(id).setData(geojson);
    else map.addSource(id, { type: 'geojson', data: geojson });
}

// =============================================================================
// Layers
// =============================================================================
function addLayers() {
    map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('sites', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({
        id: 'lines-layer', type: 'line', source: 'lines',
        filter: ['in', ['get', 'status'], ['literal', ['active', 'preserved_tourist', 'rail_trail']]],
        paint: {
            'line-color': ['match', ['get', 'status'], 'active', '#0F6E56', 'rail_trail', '#534AB7', 'preserved_tourist', '#639922', '#666'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 14, 3.5],
            'line-opacity': 0.85,
        },
    });
    map.addLayer({
        id: 'lines-layer-abandoned', type: 'line', source: 'lines',
        filter: ['==', ['get', 'status'], 'abandoned'],
        paint: { 'line-color': '#BA7517', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 14, 3.5], 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 },
    });
    map.addLayer({
        id: 'lines-layer-destroyed', type: 'line', source: 'lines',
        filter: ['==', ['get', 'status'], 'destroyed'],
        paint: { 'line-color': '#A32D2D', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 14, 3.5], 'line-dasharray': [0.6, 1.5], 'line-opacity': 0.85 },
    });
    map.addLayer({
        id: 'sites-layer', type: 'circle', source: 'sites',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 14, 8],
            'circle-color': ['match', ['get', 'status'],
                'active', '#0F6E56', 'preserved', '#1D9E75',
                'abandoned', '#BA7517', 'ruins', '#854F0B', 'destroyed', '#A32D2D',
                'daylighted_active', '#C8A500', 'daylighted_inactive', '#888888', '#666'],
            'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
            'circle-opacity': ['match', ['get', 'status'], 'destroyed', 0.75, 1.0],
        },
    });

    map.on('click', 'sites-layer', e => { showDetail(e.features[0].properties); });
    map.on('mouseenter', 'sites-layer', () => { map.getCanvas().style.cursor = state.pinMode ? 'crosshair' : 'pointer'; });
    map.on('mouseleave', 'sites-layer', () => { map.getCanvas().style.cursor = state.pinMode ? 'crosshair' : ''; });
}

// =============================================================================
// Filters
// =============================================================================
const LINE_LAYER_BASE_FILTERS = {
    'lines-layer':           ['in', ['get', 'status'], ['literal', ['active', 'preserved_tourist', 'rail_trail']]],
    'lines-layer-abandoned': ['==', ['get', 'status'], 'abandoned'],
    'lines-layer-destroyed': ['==', ['get', 'status'], 'destroyed'],
};

function applyFilters() {
    if (!map.getLayer('sites-layer') || !map.getLayer('lines-layer')) return;
    const siteTypeArr   = Array.from(state.siteTypes);
    const siteStatusArr = Array.from(state.siteStatuses);
    const lineStatusArr = Array.from(state.lineStatuses);

    map.setFilter('sites-layer', [
        'all',
        ['in', ['get', 'site_type'], ['literal', siteTypeArr]],
        ['in', ['get', 'status'],    ['literal', siteStatusArr]],
        ['any', ['==', ['get', 'built_year'],      null], ['<=', ['get', 'built_year'],      state.year]],
        ['any', ['==', ['get', 'demolished_year'], null], ['>',  ['get', 'demolished_year'],  state.year]],
    ]);

    for (const [layerId, baseFilter] of Object.entries(LINE_LAYER_BASE_FILTERS)) {
        if (!map.getLayer(layerId)) continue;
        map.setFilter(layerId, [
            'all', baseFilter,
            ['in', ['get', 'status'], ['literal', lineStatusArr]],
            ['any', ['==', ['get', 'built_year'],  null], ['<=', ['get', 'built_year'],  state.year]],
            ['any', ['==', ['get', 'removed_year'],null], ['>',  ['get', 'removed_year'], state.year]],
        ]);
    }
}

// =============================================================================
// Detail panel
// =============================================================================
let currentDetail = null;
let currentProps  = null;
let editPhotos    = [];

async function showDetail(props) {
    const panel   = document.getElementById('detail-panel');
    const content = document.getElementById('detail-content');
    panel.classList.remove('hidden');
    content.innerHTML = '<p class="hint" style="margin-top:0">Loading…</p>';

    let detail    = null;
    let sitePhotos = [];
    try {
        const res = await fetch(`${API_BASE}/api/sites/${props.id}`);
        if (res.ok) {
            detail     = await res.json();
            sitePhotos = detail.site_photos || [];
        }
    } catch (_) {}

    currentDetail = detail;
    currentProps  = props;

    // Use fresh detail values; fall back to GeoJSON props if fetch failed
    const d             = detail || {};
    const name          = d.name          ?? props.name;
    const siteType      = d.site_type     ?? props.site_type;
    const status        = d.status        ?? props.status;
    const city          = d.city          != null ? d.city          : props.city;
    const stateVal      = d.state_province != null ? d.state_province : props.state;
    const builtYear     = d.built_year    != null ? d.built_year    : props.built_year;
    const closedYear    = d.closed_year   != null ? d.closed_year   : props.closed_year;
    const demolishedYear = d.demolished_year != null ? d.demolished_year : props.demolished_year;
    const description   = d.description  != null ? d.description   : props.description;
    const submittedBy   = d.submitted_by  != null ? d.submitted_by  : props.submitted_by;
    const updatedAt     = d.updated_at;

    if (sitePhotos.length === 0 && props.photo_url) {
        sitePhotos = [{ url: props.photo_url, thumb_url: null }];
    }

    let photosHtml = '';
    if (sitePhotos.length === 1) {
        photosHtml = `<img src="${esc(sitePhotos[0].url)}" class="site-photo" alt="${esc(name)}">`;
    } else if (sitePhotos.length > 1) {
        photosHtml = `<div class="photo-gallery">${sitePhotos.map((p, i) =>
            `<img src="${esc(p.thumb_url || p.url)}" class="gallery-thumb" alt="${esc(name)} photo ${i + 1}">`
        ).join('')}</div>`;
    }

    const railroads = typeof props.railroads === 'string' ? JSON.parse(props.railroads) : (props.railroads || []);
    const dates = [];
    if (builtYear)       dates.push(`Built ${builtYear}`);
    if (closedYear)      dates.push(`Closed ${closedYear}`);
    if (demolishedYear)  dates.push(`Demolished ${demolishedYear}`);

    const canAct = auth.user && (auth.user.role === 'admin' || auth.user.id === submittedBy);

    content.innerHTML = `
        ${photosHtml}
        <h3>${esc(name)}</h3>
        <div class="meta">${esc(prettyType(siteType))}${city ? ' · ' + esc(city) + ', ' + esc(stateVal || '') : ''}</div>
        <div>
            <span class="tag tag-${status}">${esc(prettyStatus(status))}</span>
            ${railroads.map(r => `<span class="tag">${esc(r)}</span>`).join('')}
        </div>
        <p>${esc(description || 'No description yet.')}</p>
        ${dates.length ? `<div class="dates">${dates.join(' · ')}</div>` : ''}
        ${canAct ? `
            <button class="btn-edit-site"   id="btn-edit-site">Edit</button>
            <button class="btn-delete-site" data-id="${esc(props.id)}">Delete site</button>
        ` : ''}
        ${updatedAt ? `<div class="last-edited">Last edited: ${formatDate(updatedAt)}</div>` : ''}
    `;

    const singlePhoto = content.querySelector('.site-photo');
    if (singlePhoto) singlePhoto.addEventListener('click', () => openLightbox(sitePhotos, 0));
    content.querySelectorAll('.gallery-thumb').forEach((img, i) => {
        img.addEventListener('click', () => openLightbox(sitePhotos, i));
    });

    document.getElementById('btn-edit-site')?.addEventListener('click', () => {
        renderEditForm(detail || { id: props.id, name, site_type: siteType, status, city, state_province: stateVal, built_year: builtYear, closed_year: closedYear, demolished_year: demolishedYear, description });
    });

    if (canAct) {
        content.querySelector('.btn-delete-site')?.addEventListener('click', async () => {
            if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
            const res = await authedFetch(`${API_BASE}/api/sites/${props.id}`, { method: 'DELETE' });
            if (res.ok) {
                document.getElementById('detail-panel').classList.add('hidden');
                loadData();
            } else {
                const d2 = await res.json();
                alert('Delete failed: ' + d2.error);
            }
        });
    }
}

// =============================================================================
// Edit mode
// =============================================================================
function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return ''; }
}

function renderEditForm(detail) {
    const content        = document.getElementById('detail-content');
    const coords         = detail.geometry?.coordinates || [];
    const lng            = coords[0] ?? '';
    const lat            = coords[1] ?? '';
    const existingPhotos = detail.site_photos || [];
    editPhotos           = [];

    const typeOpts = [
        ['depot','Depot'],['freight_house','Freight house'],['bridge','Bridge'],
        ['trestle','Trestle'],['tunnel','Tunnel'],['yard','Yard'],
        ['roundhouse','Roundhouse'],['other','Other'],
    ];
    const statusOpts = [
        ['active','Active'],['preserved','Preserved'],['abandoned','Abandoned'],
        ['ruins','Ruins'],['destroyed','Destroyed'],
        ['daylighted_active','Daylighted / Active'],['daylighted_inactive','Daylighted / Inactive'],
    ];
    const mkOpts = (opts, cur) => opts.map(([v, l]) =>
        `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');

    content.innerHTML = `
        <div class="edit-form">
            <h3 style="margin:0 0 14px 0">Edit Site</h3>
            <label>Name<input type="text" id="ef-name" value="${esc(detail.name || '')}"></label>
            <label>Type<select id="ef-type">${mkOpts(typeOpts, detail.site_type)}</select></label>
            <label>Status<select id="ef-status">${mkOpts(statusOpts, detail.status)}</select></label>
            <label>City<input type="text" id="ef-city" value="${esc(detail.city || '')}"></label>
            <label>State<input type="text" id="ef-state" value="${esc(detail.state_province || '')}" maxlength="2"></label>
            <label>Latitude<input type="number" id="ef-lat" step="any" value="${lat}"></label>
            <label>Longitude<input type="number" id="ef-lng" step="any" value="${lng}"></label>
            <label>Year built<input type="number" id="ef-built" value="${detail.built_year || ''}"></label>
            <label>Year closed<input type="number" id="ef-closed" value="${detail.closed_year || ''}"></label>
            <label>Year demolished<input type="number" id="ef-demo" value="${detail.demolished_year || ''}"></label>
            <label>Description<textarea id="ef-desc" rows="3">${esc(detail.description || '')}</textarea></label>
            ${existingPhotos.length > 0 ? `
            <p style="font-size:12px;font-weight:600;color:#555;margin:0 0 4px 0">Existing Photos</p>
            <div id="ef-existing-grid" class="photo-grid" style="margin-bottom:12px">
                ${existingPhotos.map(p => `
                    <div class="photo-grid-item" data-photo-id="${p.id}">
                        <img src="${esc(p.thumb_url || p.url)}" alt="Photo">
                        <button type="button" class="photo-grid-remove ef-del-photo" data-photo-id="${p.id}" title="Delete photo">×</button>
                    </div>
                `).join('')}
            </div>` : ''}
            <p style="font-size:12px;font-weight:600;color:#555;margin:0 0 4px 0">Add Photos</p>
            <div id="ef-photo-drop" class="photo-drop">
                <input type="file" id="ef-photo-file" accept="image/*" class="photo-file-overlay" multiple>
                <div id="ef-photo-preview" class="photo-preview-empty">
                    <span>📷 Drop images here, or click to browse</span>
                </div>
                <div id="ef-photo-progress" class="photo-progress hidden">
                    <div id="ef-photo-bar" class="photo-bar"></div>
                </div>
            </div>
            <div id="ef-photo-grid" class="photo-grid"></div>
            <div class="form-btns">
                <button class="btn-secondary" id="ef-cancel">Cancel</button>
                <button class="btn-primary"   id="ef-save">Save Changes</button>
            </div>
            <p id="ef-status-msg" class="form-status"></p>
        </div>
    `;

    wireEditPhotoUpload();

    document.querySelectorAll('.ef-del-photo').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this photo? This cannot be undone.')) return;
            const photoId = btn.dataset.photoId;
            const res = await authedFetch(
                `${API_BASE}/api/sites/${detail.id}/photos/${photoId}`,
                { method: 'DELETE' }
            );
            if (res.ok) {
                btn.closest('.photo-grid-item').remove();
            } else {
                const d = await res.json().catch(() => ({}));
                alert('Delete failed: ' + (d.error || 'unknown error'));
            }
        });
    });

    document.getElementById('ef-cancel').addEventListener('click', () => showDetail(currentProps));
    document.getElementById('ef-save').addEventListener('click',   () => saveEdit(detail.id));
}

function wireEditPhotoUpload() {
    const dropZone  = document.getElementById('ef-photo-drop');
    const fileInput = document.getElementById('ef-photo-file');
    if (!dropZone || !fileInput) return;
    dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', e => {
        if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', async e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        for (const file of Array.from(e.dataTransfer.files).slice(0, 10 - editPhotos.length)) {
            await handleEditPhotoFile(file);
        }
    });
    fileInput.addEventListener('change', async e => {
        for (const file of Array.from(e.target.files).slice(0, 10 - editPhotos.length)) {
            await handleEditPhotoFile(file);
        }
    });
}

async function handleEditPhotoFile(file) {
    if (!file?.type.startsWith('image/')) return;
    const preview  = document.getElementById('ef-photo-preview');
    const progress = document.getElementById('ef-photo-progress');
    const bar      = document.getElementById('ef-photo-bar');
    if (!preview || !progress || !bar) return;
    progress.classList.remove('hidden');
    bar.style.width = '15%';
    preview.innerHTML = `<span class="photo-uploading">⏳ Uploading…</span>`;
    try {
        const form = new FormData();
        form.append('photo', file);
        bar.style.width = '50%';
        const res  = await fetch(`${API_BASE}/api/upload/photo`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${auth.token}` },
            body: form,
        });
        bar.style.width = '90%';
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        bar.style.width = '100%';
        editPhotos.push({ url: data.url, thumb_url: data.thumb_url });
        renderEditPhotoGrid();
        setTimeout(() => {
            progress.classList.add('hidden');
            bar.style.width = '0';
            const fi   = document.getElementById('ef-photo-file');
            const prev = document.getElementById('ef-photo-preview');
            if (fi)   fi.value = '';
            if (prev) prev.innerHTML = `<span>📷 ${editPhotos.length > 0 ? 'Add another image' : 'Drop images here, or click to browse'}</span>`;
        }, 400);
    } catch (err) {
        progress.classList.add('hidden');
        bar.style.width = '0';
        preview.innerHTML = `<span class="photo-err">✕ ${esc(err.message)}</span>`;
    }
}

function renderEditPhotoGrid() {
    const grid = document.getElementById('ef-photo-grid');
    if (!grid) return;
    if (editPhotos.length === 0) { grid.innerHTML = ''; return; }
    grid.innerHTML = editPhotos.map((p, i) => `
        <div class="photo-grid-item">
            <img src="${esc(p.thumb_url || p.url)}" alt="New photo ${i + 1}">
            <button type="button" class="photo-grid-remove" data-idx="${i}" title="Remove">×</button>
        </div>
    `).join('');
    grid.querySelectorAll('.photo-grid-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            editPhotos.splice(parseInt(btn.dataset.idx), 1);
            renderEditPhotoGrid();
        });
    });
}

async function saveEdit(siteId) {
    const msg      = document.getElementById('ef-status-msg');
    const name     = document.getElementById('ef-name').value.trim();
    const siteType = document.getElementById('ef-type').value;
    const status   = document.getElementById('ef-status').value;
    const latVal   = parseFloat(document.getElementById('ef-lat').value);
    const lngVal   = parseFloat(document.getElementById('ef-lng').value);

    if (!name || !siteType || !status) {
        msg.textContent = '✕ Name, type, and status are required.';
        msg.className   = 'form-status err';
        return;
    }
    msg.textContent = 'Saving…';
    msg.className   = 'form-status';

    try {
        const res = await authedFetch(`${API_BASE}/api/sites/${siteId}`, {
            method: 'PATCH',
            body: JSON.stringify({
                name,
                site_type:       siteType,
                status,
                lat:             Number.isFinite(latVal) ? latVal : null,
                lng:             Number.isFinite(lngVal) ? lngVal : null,
                city:            document.getElementById('ef-city').value.trim()   || null,
                state_province:  document.getElementById('ef-state').value.trim().toUpperCase() || null,
                built_year:      parseInt(document.getElementById('ef-built').value)   || null,
                closed_year:     parseInt(document.getElementById('ef-closed').value)  || null,
                demolished_year: parseInt(document.getElementById('ef-demo').value)    || null,
                description:     document.getElementById('ef-desc').value.trim()   || null,
                photos:          editPhotos.length > 0 ? editPhotos : undefined,
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        msg.textContent = '✓ Saved!';
        msg.className   = 'form-status ok';
        await loadData();
        setTimeout(() => showDetail(currentProps), 800);
    } catch (err) {
        msg.textContent = '✕ ' + err.message;
        msg.className   = 'form-status err';
    }
}

document.getElementById('close-detail').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.add('hidden');
});

// =============================================================================
// Lightbox
// =============================================================================
let lbPhotos = [];
let lbIndex  = 0;

function openLightbox(photos, index) {
    lbPhotos = photos;
    lbIndex  = index;
    updateLightbox();
    document.getElementById('lightbox').classList.remove('hidden');
}

function closeLightbox() {
    document.getElementById('lightbox').classList.add('hidden');
}

function updateLightbox() {
    document.getElementById('lb-img').src = lbPhotos[lbIndex].url;
    document.getElementById('lb-prev').classList.toggle('hidden', lbIndex === 0);
    document.getElementById('lb-next').classList.toggle('hidden', lbIndex === lbPhotos.length - 1);
    const counter = document.getElementById('lb-counter');
    if (lbPhotos.length > 1) {
        counter.textContent = `${lbIndex + 1} / ${lbPhotos.length}`;
        counter.classList.remove('hidden');
    } else {
        counter.classList.add('hidden');
    }
}

document.getElementById('lb-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLightbox();
});
document.getElementById('lb-prev').addEventListener('click', e => {
    e.stopPropagation();
    if (lbIndex > 0) { lbIndex--; updateLightbox(); }
});
document.getElementById('lb-next').addEventListener('click', e => {
    e.stopPropagation();
    if (lbIndex < lbPhotos.length - 1) { lbIndex++; updateLightbox(); }
});
document.addEventListener('keydown', e => {
    if (document.getElementById('lightbox').classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft'  && lbIndex > 0)                      { lbIndex--; updateLightbox(); }
    if (e.key === 'ArrowRight' && lbIndex < lbPhotos.length - 1)    { lbIndex++; updateLightbox(); }
});

// =============================================================================
// Helpers
// =============================================================================
function esc(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]); }
function prettyType(t) { return ({ depot:'Depot', freight_house:'Freight house', bridge:'Bridge', trestle:'Trestle', tunnel:'Tunnel', yard:'Yard', roundhouse:'Roundhouse' })[t] || t; }
function prettyStatus(s) { return ({ active:'Active', preserved:'Preserved', abandoned:'Abandoned', ruins:'Ruins', destroyed:'Destroyed', daylighted_active:'Daylighted / Active', daylighted_inactive:'Daylighted / Inactive' })[s] || s; }

// =============================================================================
// UI wiring — filter checkboxes
// =============================================================================
document.querySelectorAll('input[data-filter]').forEach(input => {
    input.addEventListener('change', () => {
        const bucket = input.dataset.filter;
        const target = bucket === 'line-status' ? state.lineStatuses
                     : bucket === 'site-type'   ? state.siteTypes
                     : state.siteStatuses;
        input.checked ? target.add(input.value) : target.delete(input.value);
        applyFilters();
    });
});

// Year slider
const yearSlider = document.getElementById('year');
const yearLabel  = document.getElementById('year-label');
yearSlider.addEventListener('input', () => {
    state.year = parseInt(yearSlider.value, 10);
    yearLabel.textContent = state.year;
    applyFilters();
    if (state.historicMaps.length && state.overlayOpacity > 0) updateOverlayForYear(state.year);
});

// Overlay opacity slider
const overlaySlider = document.getElementById('overlay-opacity');
overlaySlider.addEventListener('input', () => {
    state.overlayOpacity = parseInt(overlaySlider.value, 10);
    const op = state.overlayOpacity / 100;
    if (state.historicMaps.length && state.overlayOpacity > 0) {
        if (!state.activeMapId) updateOverlayForYear(state.year);
        else if (map.getLayer('historic-overlay')) map.setPaintProperty('historic-overlay', 'raster-opacity', op);
    } else if (map.getLayer('historic-overlay')) {
        map.setPaintProperty('historic-overlay', 'raster-opacity', op);
    }
});

// =============================================================================
// Fallback data (if backend unreachable)
// =============================================================================
function useFallbackData() {
    const sites = {
        type: 'FeatureCollection',
        features: [
            makeSite('Falmouth L&N Depot',        'depot',    'destroyed', -84.3294, 38.6770, 1869, 1971, 1978, 'Wooden Queen Anne depot, demolished late 1970s.'),
            makeSite('Licking River Bridge',       'bridge',   'active',    -84.3260, 38.6795, 1888, null, null, 'Steel through-truss on the CSX line.'),
            makeSite('Cincinnati Union Terminal',  'depot',    'preserved', -84.5370, 39.1099, 1933, null, null, 'Art Deco masterpiece, now the Cincinnati Museum Center.'),
        ],
    };
    addOrUpdateSource('sites', sites);
    addOrUpdateSource('lines', { type: 'FeatureCollection', features: [] });
    applyFilters();
}

function makeSite(name, site_type, status, lng, lat, built, closed, demo, desc) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
             properties: { name, site_type, status, built_year: built, closed_year: closed, demolished_year: demo, description: desc, railroads: [] } };
}

// =============================================================================
// Map notice
// =============================================================================
(function initMapNotice() {
    if (!localStorage.getItem('ir_notice_dismissed')) {
        document.getElementById('map-notice')?.classList.remove('hidden');
    }
})();

document.getElementById('map-notice-close')?.addEventListener('click', () => {
    document.getElementById('map-notice').classList.add('hidden');
    localStorage.setItem('ir_notice_dismissed', '1');
});

function maybeHideMapNotice(featureCount) {
    if (featureCount >= 50) document.getElementById('map-notice')?.classList.add('hidden');
}

// =============================================================================
// Boot
// =============================================================================
map.on('load', () => {
    addLayers();
    loadData();
    loadHistoricMaps();
});

renderNav();
handleVerifyEmail();
