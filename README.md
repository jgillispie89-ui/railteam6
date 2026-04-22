# Iron Roads

An interactive atlas of American railroads — active lines, abandoned corridors, lost depots, ghost bridges, and forgotten tunnels. Modeled after OldMapsOnline, but purpose-built for railroad history.

## Roadmap

### Phase 1 — Local prototype (weeks 1–3)
Goal: get a working map running on your machine with real data for one region.
- [x] Tech stack chosen (MapLibre GL JS + PostgreSQL/PostGIS + Node/Express)
- [x] Database schema drafted
- [x] Frontend skeleton with map, filter sidebar, timeline slider
- [ ] Seed with ~50 hand-verified sites in Kentucky/Ohio
- [ ] Click marker → detail panel with photos and sources

### Phase 2 — Real data pipeline (weeks 4–8)
- [ ] Import Rails-to-Trails abandoned corridors shapefiles (~40,000 miles nationwide)
- [ ] Overlay USGS historical topographic maps via their tile service
- [ ] Import Wikipedia "List of defunct railroads" articles as structured data
- [ ] Sanborn fire insurance map overlay for selected cities (Library of Congress)

### Phase 3 — Contributors (weeks 9–14)
- [ ] User accounts (email + OAuth)
- [ ] "Add a site" form with photo upload, source citation, map click-to-pin
- [ ] Moderation queue — new submissions need review before going live
- [ ] Edit history per site (who changed what, when)
- [ ] Photo EXIF extraction for auto-location

### Phase 4 — Polish and launch (weeks 15–20)
- [ ] Search (by railroad, by town, by person's name)
- [ ] Per-railroad pages (L&N, C&O, Pennsylvania RR...)
- [ ] Mobile-responsive design, offline tile cache for field trips
- [ ] Admin dashboard
- [ ] Domain, hosting, deploy

### Phase 5 — Worldwide expansion
- [ ] Internationalize coordinate handling (already in WGS84)
- [ ] UK, Germany, Japan — countries with strong rail history and good data
- [ ] i18n for UI strings
- [ ] Regional moderators

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Map library | **MapLibre GL JS** | Open source fork of Mapbox GL JS, WebGL-fast, vector tiles, runtime styling, handles 10k+ markers |
| Basemap tiles | **OpenStreetMap** initially, **Protomaps** later | Free. Protomaps lets you self-host PMTiles for cost control |
| Historic overlays | **Allmaps** | Free georeferencing viewer, uses IIIF |
| Frontend | **Vanilla JS + Vite** (v1) → **React + TypeScript** (v2) | Start simple, migrate when complexity demands |
| Backend | **Node.js + Express + TypeScript** | Simple, fast, one language across stack |
| Database | **PostgreSQL 16 + PostGIS** | The standard for geographic data |
| Image storage | **Cloudflare R2** or **S3** | Cheap, CDN-backed |
| Auth | **Lucia** or **Auth.js** | Modern, no vendor lock-in |
| Hosting | **Fly.io** or **Railway** (app) + **Neon** (Postgres) | Affordable, Postgres-native |

## Data sources (free / public domain)

1. **Rails-to-Trails Conservancy** — abandoned corridor GIS data
2. **USGS Historical Topographic Map Collection** — scanned topos 1880s–present, free tiles
3. **Library of Congress Sanborn Maps** — downtown depot footprints, public domain
4. **Wikipedia / Wikidata** — defunct railroads lists, depot articles
5. **OpenStreetMap** — active rail lines, current depots
6. **Bureau of Transportation Statistics** — current rail network GIS
7. **State historical societies** — depot registries, photo archives
8. **Railroad and Locomotive Historical Society** — academic records

## How to run (v1 prototype)

See `frontend/README.md` and `backend/README.md`. TL;DR:

```bash
# Database (requires Postgres 16 + PostGIS)
psql -U postgres -c "CREATE DATABASE ironroads;"
psql -U postgres -d ironroads -f db/schema.sql
psql -U postgres -d ironroads -f db/seed.sql

# Backend
cd backend && npm install && npm run dev    # http://localhost:3001

# Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```
