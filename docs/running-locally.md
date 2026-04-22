# How to run Iron Roads on your computer

The first time through, this takes about 30–45 minutes. Most of that is installing PostgreSQL + PostGIS if you don't have them. After that, `npm run dev` in each folder gets you going in seconds.

## 1. Install prerequisites

You need three things:

- **Node.js 20 or newer** — https://nodejs.org (pick the LTS installer)
- **PostgreSQL 16** — https://www.postgresql.org/download
- **PostGIS extension** for PostgreSQL — bundled in the Windows "Stack Builder" wizard after PG install, or on macOS `brew install postgis`, or on Linux `sudo apt install postgresql-16-postgis-3`

To verify:
```bash
node -v        # should print v20.x or higher
psql --version # should print psql (PostgreSQL) 16.x
```

## 2. Create the database

```bash
# Open a terminal. On Windows, use "SQL Shell (psql)" from the Start menu.
createdb ironroads
psql -d ironroads -c "CREATE EXTENSION postgis;"

# Load schema and seed data:
cd path/to/iron-roads
psql -d ironroads -f db/schema.sql
psql -d ironroads -f db/seed.sql
```

You should now have 8 sites loaded. Sanity check:
```bash
psql -d ironroads -c "SELECT name, site_type, status FROM sites;"
```

## 3. Start the backend

```bash
cd backend
cp .env.example .env
# Edit .env if your Postgres username/password isn't the default "postgres"
npm install
npm run dev
```

Leave this terminal running. You should see: `Iron Roads API listening on http://localhost:3001`

Test it: open http://localhost:3001/api/health in a browser. You should get `{"ok":true,"postgis":"3.x..."}`.

## 4. Start the frontend

Open a **second** terminal:
```bash
cd frontend
npm install
npm run dev
```

Visit **http://localhost:5173**. You should see a map centered on Falmouth, Kentucky with colored markers for the seed sites. Click any marker for details. Drag the timeline slider — watch Cincinnati Union Terminal appear only after 1933. Drag the "Historic overlay" opacity slider to fade in a historical-style basemap.

## 5. What to build next

Now that it works locally, the next steps in priority order:

1. **Add 20 more sites you personally know** — start documenting Kentucky railroads properly. Edit `db/seed.sql` and re-run it, or use `psql` directly.
2. **Connect a real photo** to a site — add rows to the `photos` table pointing at URLs (local file, Flickr, Wikimedia Commons).
3. **Wire up historic map overlays** — replace the placeholder tile URL in `main.js` with actual georeferenced historic map tiles. Allmaps (https://allmaps.org) is the easiest starting point.
4. **Build the "Add a site" form** — a simple page that clicks the map to drop a pin, then POSTs to a new `/api/sites` endpoint.
5. **Import Rails-to-Trails data** — their abandoned corridors shapefiles drop straight into the `lines` table via `shp2pgsql`.

## Troubleshooting

- **`psql: command not found`** — Postgres isn't on your PATH. On Windows, use the "SQL Shell (psql)" from the Start menu instead. On macOS: `echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc`.
- **Backend says `ECONNREFUSED`** — Postgres isn't running. Start it from Services (Windows) or `brew services start postgresql@16`.
- **Frontend loads but map is empty** — check the backend terminal for errors, then the browser devtools Network tab. If the API is down, the frontend falls back to embedded sample data so you'll still see markers.
- **Markers don't filter correctly when moving the timeline** — that's a sign the properties aren't flowing through. Open devtools and `console.log` inside `applyFilters()`.
