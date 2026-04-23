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
// State
// =============================================================================
const state = {
    year: 2026,
    lineStatuses: new Set(['active', 'abandoned', 'destroyed', 'rail_trail']),
    siteTypes: new Set(['depot','freight_house','bridge','trestle','tunnel','yard','roundhouse']),
    siteStatuses: new Set(['active','preserved','abandoned','ruins','destroyed']),
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
        map.addSource('historic-overlay', {
            type: 'raster', tiles: [m.tile_url], tileSize: 256,
            attribution: m.title,
        });
        map.addLayer({
            id: 'historic-overlay', type: 'raster', source: 'historic-overlay',
            paint: { 'raster-opacity': opacity },
        }, 'lines-layer');
    }
    document.getElementById('overlay-hint').textContent = `Showing: ${m.title} (${m.published_year})`;
    renderMapLibrary();
}

function updateOverlayForYear(year) {
    if (!state.historicMaps.length) return;
    const closest = state.historicMaps.reduce((best, m) => {
        return Math.abs(m.published_year - year) < Math.abs(best.published_year - year) ? m : best;
    });
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
    enterPinMode();
});

// =============================================================================
// Site submission form
// =============================================================================
function openSiteForm() { document.getElementById('site-form').classList.remove('hidden'); }
function closeSiteForm() {
    document.getElementById('site-form').classList.add('hidden');
    document.getElementById('sf-status-msg').textContent = '';
    state.pendingPinLngLat = null;
}

document.getElementById('sf-cancel').addEventListener('click', closeSiteForm);
document.getElementById('sf-submit').addEventListener('click', async () => {
    const msg = document.getElementById('sf-status-msg');
    const [lng, lat] = state.pendingPinLngLat || [null, null];
    const body = {
        name: document.getElementById('sf-name').value.trim(),
        site_type: document.getElementById('sf-type').value,
        status: document.getElementById('sf-status').value,
        lng, lat,
        city: document.getElementById('sf-city').value.trim() || null,
        state_province: document.getElementById('sf-state').value.trim().toUpperCase() || null,
        built_year: parseInt(document.getElementById('sf-built').value) || null,
        closed_year: parseInt(document.getElementById('sf-closed').value) || null,
        demolished_year: parseInt(document.getElementById('sf-demo').value) || null,
        description: document.getElementById('sf-desc').value.trim() || null,
    };
    try {
        const res = await fetch(`${API_BASE}/api/sites`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        msg.textContent = '✓ Site submitted! Reloading map...';
        msg.className = 'form-status ok';
        setTimeout(async () => { closeSiteForm(); await loadData(); }, 1200);
    } catch (err) {
        msg.textContent = '✕ ' + err.message;
        msg.className = 'form-status err';
    }
});

// =============================================================================
// Add historic map form
// =============================================================================
document.getElementById('btn-add-map').addEventListener('click', () => {
    document.getElementById('map-form').classList.remove('hidden');
});
document.getElementById('mf-cancel').addEventListener('click', () => {
    document.getElementById('map-form').classList.add('hidden');
});
document.getElementById('mf-submit').addEventListener('click', async () => {
    const msg = document.getElementById('mf-status-msg');
    const body = {
        title: document.getElementById('mf-title').value.trim(),
        published_year: parseInt(document.getElementById('mf-year').value),
        tile_url: document.getElementById('mf-url').value.trim(),
        publisher: document.getElementById('mf-publisher').value.trim() || null,
        source_url: document.getElementById('mf-source-url').value.trim() || null,
    };
    if (!body.title || !body.published_year || !body.tile_url) {
        msg.textContent = '✕ Title, year, and tile URL are required.';
        msg.className = 'form-status err';
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/api/historic-maps`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        msg.textContent = '✓ Map added!';
        msg.className = 'form-status ok';
        await loadHistoricMaps();
        setTimeout(() => { document.getElementById('map-form').classList.add('hidden'); }, 1000);
    } catch (err) {
        msg.textContent = '✕ ' + err.message;
        msg.className = 'form-status err';
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
    } catch (err) {
        console.warn('Backend unreachable:', err);
        useFallbackData();
    }
}

function addOrUpdateSource(id, geojson) {
    if (map.getSource(id)) {
        map.getSource(id).setData(geojson);
    } else {
        map.addSource(id, { type: 'geojson', data: geojson });
    }
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
        paint: {
            'line-color': '#BA7517',
            'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 14, 3.5],
            'line-dasharray': [2, 1.5], 'line-opacity': 0.85,
        },
    });
    map.addLayer({
        id: 'lines-layer-destroyed', type: 'line', source: 'lines',
        filter: ['==', ['get', 'status'], 'destroyed'],
        paint: {
            'line-color': '#A32D2D',
            'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 14, 3.5],
            'line-dasharray': [0.6, 1.5], 'line-opacity': 0.85,
        },
    });
    map.addLayer({
        id: 'sites-layer', type: 'circle', source: 'sites',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 14, 8],
            'circle-color': ['match', ['get', 'status'],
                'active', '#0F6E56', 'preserved', '#1D9E75',
                'abandoned', '#BA7517', 'ruins', '#854F0B', 'destroyed', '#A32D2D', '#666'],
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
    const siteTypeArr = Array.from(state.siteTypes);
    const siteStatusArr = Array.from(state.siteStatuses);
    const lineStatusArr = Array.from(state.lineStatuses);

    map.setFilter('sites-layer', [
        'all',
        ['in', ['get', 'site_type'], ['literal', siteTypeArr]],
        ['in', ['get', 'status'], ['literal', siteStatusArr]],
        ['any', ['==', ['get', 'built_year'], null], ['<=', ['get', 'built_year'], state.year]],
        ['any', ['==', ['get', 'demolished_year'], null], ['>', ['get', 'demolished_year'], state.year]],
    ]);

    for (const [layerId, baseFilter] of Object.entries(LINE_LAYER_BASE_FILTERS)) {
        if (!map.getLayer(layerId)) continue;
        map.setFilter(layerId, [
            'all', baseFilter,
            ['in', ['get', 'status'], ['literal', lineStatusArr]],
            ['any', ['==', ['get', 'built_year'], null], ['<=', ['get', 'built_year'], state.year]],
            ['any', ['==', ['get', 'removed_year'], null], ['>', ['get', 'removed_year'], state.year]],
        ]);
    }
}

// =============================================================================
// Detail panel
// =============================================================================
function showDetail(props) {
    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('detail-content');
    const railroads = typeof props.railroads === 'string' ? JSON.parse(props.railroads) : (props.railroads || []);
    const dates = [];
    if (props.built_year) dates.push(`Built ${props.built_year}`);
    if (props.closed_year) dates.push(`Closed ${props.closed_year}`);
    if (props.demolished_year) dates.push(`Demolished ${props.demolished_year}`);
    content.innerHTML = `
        <h3>${esc(props.name)}</h3>
        <div class="meta">${esc(prettyType(props.site_type))}${props.city ? ' · ' + esc(props.city) + ', ' + esc(props.state || '') : ''}</div>
        <div>
            <span class="tag tag-${props.status}">${esc(prettyStatus(props.status))}</span>
            ${railroads.map(r => `<span class="tag">${esc(r)}</span>`).join('')}
        </div>
        <p>${esc(props.description || 'No description yet. If you know the history of this site, consider contributing.')}</p>
        ${dates.length ? `<div class="dates">${dates.join(' · ')}</div>` : ''}
    `;
    panel.classList.remove('hidden');
}

document.getElementById('close-detail').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.add('hidden');
});

function esc(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]); }
function prettyType(t) { return ({ depot:'Depot', freight_house:'Freight house', bridge:'Bridge', trestle:'Trestle', tunnel:'Tunnel', yard:'Yard', roundhouse:'Roundhouse' })[t] || t; }
function prettyStatus(s) { return ({ active:'Active', preserved:'Preserved', abandoned:'Abandoned', ruins:'Ruins', destroyed:'Destroyed' })[s] || s; }

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
const yearLabel = document.getElementById('year-label');
yearSlider.addEventListener('input', () => {
    state.year = parseInt(yearSlider.value, 10);
    yearLabel.textContent = state.year;
    applyFilters();
    if (state.historicMaps.length && state.overlayOpacity > 0) {
        updateOverlayForYear(state.year);
    }
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
// Fallback data (if backend is down)
// =============================================================================
function useFallbackData() {
    const sites = {
        type: 'FeatureCollection',
        features: [
            makeSite('Falmouth L&N Depot', 'depot', 'destroyed', -84.3294, 38.6770, 1869, 1971, 1978, 'Wooden Queen Anne depot, demolished late 1970s.', ['L&N']),
            makeSite('Licking River Bridge (Falmouth)', 'bridge', 'active', -84.3260, 38.6795, 1888, null, null, 'Steel through-truss on the CSX line.', ['L&N','CSX']),
            makeSite('Cincinnati Union Terminal', 'depot', 'preserved', -84.5370, 39.1099, 1933, null, null, 'Art Deco masterpiece, now the Cincinnati Museum Center.', ['L&N','C&O']),
        ],
    };
    addOrUpdateSource('sites', sites);
    addOrUpdateSource('lines', { type: 'FeatureCollection', features: [] });
    applyFilters();
}

function makeSite(name, site_type, status, lng, lat, built, closed, demo, desc, railroads) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
             properties: { name, site_type, status, built_year: built, closed_year: closed, demolished_year: demo, description: desc, railroads } };
}

// =============================================================================
// Boot
// =============================================================================
map.on('load', () => {
    addLayers();
    loadData();
    loadHistoricMaps();
});
