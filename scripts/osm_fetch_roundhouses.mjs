#!/usr/bin/env node
// Fetch US roundhouses + turntables from OpenStreetMap (Overpass API),
// filter, dedupe, and write osm_roundhouses.json next to this script.
//
// Usage: node scripts/osm_fetch_roundhouses.mjs

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_QUERY = `
[out:json][timeout:60];
area["name"="United States"]->.usa;
(
  nwr["railway"="roundhouse"](area.usa);
  nwr["building"="roundhouse"](area.usa);
  nwr["railway"="turntable"](area.usa);
);
out center;
`.trim();

// Continental-USA bbox per task spec
const BBOX = { minLat: 24, maxLat: 50, minLon: -125, maxLon: -66 };
const DEDUPE_RADIUS_M = 50;

function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function extractLatLon(el) {
    if (el.type === 'node') return { lat: el.lat, lon: el.lon };
    if (el.center) return { lat: el.center.lat, lon: el.center.lon };
    return { lat: null, lon: null };
}

function extractRailwayTag(tags) {
    if (!tags) return null;
    if (tags.railway === 'roundhouse') return 'roundhouse';
    if (tags.railway === 'turntable') return 'turntable';
    if (tags.building === 'roundhouse') return 'roundhouse';
    return tags.railway || tags.building || null;
}

function extractAddress(tags) {
    if (!tags) return null;
    const parts = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:city'],
        tags['addr:state'],
        tags['addr:postcode'],
    ].filter(Boolean);
    if (parts.length) return parts.join(', ');
    return tags['addr:full'] || null;
}

function extractName(tags, railway) {
    if (tags?.name) return tags.name;
    if (railway === 'turntable') return 'Unnamed Turntable';
    return 'Unnamed Roundhouse';
}

async function main() {
    console.log('[osm] Querying Overpass API…');
    const t0 = Date.now();
    const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'RailTeam6-OSM-Import/0.1 (https://railteam6.com)',
        },
        body: 'data=' + encodeURIComponent(OVERPASS_QUERY),
    });
    if (!res.ok) {
        throw new Error(`Overpass returned HTTP ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    const rawElements = json.elements || [];
    console.log(`[osm] Got ${rawElements.length} raw elements in ${Date.now() - t0}ms`);

    // Step 1: extract structured records
    const extracted = rawElements.map((el) => {
        const { lat, lon } = extractLatLon(el);
        const railway = extractRailwayTag(el.tags);
        return {
            name: extractName(el.tags, railway),
            lat,
            lon,
            osm_type: el.type,
            osm_id: el.id,
            railway_tag: railway,
            state: el.tags?.['addr:state'] || null,
            address: extractAddress(el.tags),
            raw_tags: el.tags || {},
        };
    });

    // Step 2: filtering
    const removed = { no_coords: 0, out_of_bbox: 0, dedup: 0 };
    const dedup_examples = { no_coords: [], out_of_bbox: [], dedup: [] };

    const withCoords = [];
    for (const r of extracted) {
        if (r.lat == null || r.lon == null || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) {
            removed.no_coords++;
            if (dedup_examples.no_coords.length < 3) dedup_examples.no_coords.push({ osm_type: r.osm_type, osm_id: r.osm_id, name: r.name });
            continue;
        }
        withCoords.push(r);
    }

    const inBbox = [];
    for (const r of withCoords) {
        if (r.lat < BBOX.minLat || r.lat > BBOX.maxLat || r.lon < BBOX.minLon || r.lon > BBOX.maxLon) {
            removed.out_of_bbox++;
            if (dedup_examples.out_of_bbox.length < 3) dedup_examples.out_of_bbox.push({ osm_type: r.osm_type, osm_id: r.osm_id, name: r.name, lat: r.lat, lon: r.lon });
            continue;
        }
        inBbox.push(r);
    }

    // Step 3: dedupe within 50m. Keep the first; record the duplicate.
    const kept = [];
    const duplicates = [];
    for (const r of inBbox) {
        let dupOf = null;
        for (const k of kept) {
            if (haversineMeters(r, k) <= DEDUPE_RADIUS_M) {
                dupOf = k;
                break;
            }
        }
        if (dupOf) {
            removed.dedup++;
            duplicates.push({ kept: { osm_type: dupOf.osm_type, osm_id: dupOf.osm_id, name: dupOf.name }, dropped: { osm_type: r.osm_type, osm_id: r.osm_id, name: r.name, lat: r.lat, lon: r.lon } });
            if (dedup_examples.dedup.length < 3) dedup_examples.dedup.push(duplicates[duplicates.length - 1]);
            continue;
        }
        kept.push(r);
    }

    const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'osm_roundhouses.json');
    const out = {
        fetched_at: new Date().toISOString(),
        overpass_query: OVERPASS_QUERY,
        counts: {
            raw: rawElements.length,
            kept: kept.length,
            removed_no_coords: removed.no_coords,
            removed_out_of_bbox: removed.out_of_bbox,
            removed_dedup: removed.dedup,
        },
        removed_examples: dedup_examples,
        duplicates,
        entries: kept,
    };
    await writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');

    console.log(`[osm] Wrote ${outPath}`);
    console.log(`[osm] Counts:`);
    console.log(`        raw:             ${rawElements.length}`);
    console.log(`        no_coords:       ${removed.no_coords}`);
    console.log(`        out_of_bbox:     ${removed.out_of_bbox}`);
    console.log(`        dedup_within_50m:${removed.dedup}`);
    console.log(`        kept:            ${kept.length}`);
    const byTag = kept.reduce((acc, r) => ((acc[r.railway_tag || 'unknown'] = (acc[r.railway_tag || 'unknown'] || 0) + 1), acc), {});
    console.log(`[osm] By railway tag:`, byTag);
}

main().catch((err) => {
    console.error('[osm] FAILED:', err);
    process.exit(1);
});
