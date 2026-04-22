-- Iron Roads database schema
-- PostgreSQL 16 + PostGIS 3.x
-- Run: psql -U postgres -d ironroads -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- RAILROADS — the companies/operators that owned lines and depots
-- =============================================================================
CREATE TABLE railroads (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    abbreviation    TEXT,                 -- "L&N", "C&O", "PRR"
    founded_year    INTEGER,
    dissolved_year  INTEGER,              -- NULL if still operating
    successor_id    UUID REFERENCES railroads(id),  -- merged into this one
    country         TEXT NOT NULL DEFAULT 'US',
    wikipedia_url   TEXT,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_railroads_name ON railroads(name);
CREATE INDEX idx_railroads_country ON railroads(country);

-- =============================================================================
-- LINES — geometric rail corridors (linestrings)
-- =============================================================================
CREATE TYPE line_status AS ENUM ('active', 'abandoned', 'destroyed', 'rail_trail', 'preserved_tourist');

CREATE TABLE lines (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT,                 -- "Cincinnati Southern main line"
    railroad_id     UUID REFERENCES railroads(id),
    status          line_status NOT NULL,
    built_year      INTEGER,
    abandoned_year  INTEGER,              -- when service ended
    removed_year    INTEGER,              -- when track was lifted
    length_miles    NUMERIC(8, 2),
    gauge_mm        INTEGER,              -- 1435 = standard
    geom            GEOMETRY(LineString, 4326) NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_lines_geom ON lines USING GIST(geom);
CREATE INDEX idx_lines_railroad ON lines(railroad_id);
CREATE INDEX idx_lines_status ON lines(status);
CREATE INDEX idx_lines_built ON lines(built_year);

-- =============================================================================
-- SITES — point locations: depots, bridges, tunnels, yards, junctions
-- =============================================================================
CREATE TYPE site_type AS ENUM (
    'depot',           -- passenger station
    'freight_house',   -- freight-only station
    'bridge',
    'trestle',
    'tunnel',
    'yard',
    'roundhouse',
    'water_tower',
    'coaling_tower',
    'junction',
    'interlocking',
    'wreck_site',      -- historic accident locations
    'other'
);

CREATE TYPE site_status AS ENUM (
    'active',          -- still in railroad service
    'preserved',       -- standing, not in service (museum, repurposed)
    'abandoned',       -- standing but derelict
    'ruins',           -- partial remains visible
    'destroyed',       -- completely gone, site only
    'relocated',       -- moved elsewhere
    'unknown'
);

CREATE TABLE sites (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    site_type       site_type NOT NULL,
    status          site_status NOT NULL,
    geom            GEOMETRY(Point, 4326) NOT NULL,
    built_year      INTEGER,
    closed_year     INTEGER,              -- service ended
    demolished_year INTEGER,              -- physical removal
    elevation_ft    INTEGER,
    address         TEXT,
    city            TEXT,
    state_province  TEXT,
    country         TEXT NOT NULL DEFAULT 'US',
    description     TEXT,                 -- narrative, can be long
    architect       TEXT,                 -- when known
    architectural_style TEXT,             -- "Queen Anne", "Richardsonian Romanesque"
    -- Bridge/tunnel specific (NULL for other types)
    span_ft         INTEGER,
    construction_type TEXT,               -- "iron truss", "concrete arch", "steel deck plate girder"
    -- Sourcing
    wikipedia_url   TEXT,
    external_refs   JSONB DEFAULT '{}'::jsonb,  -- {nrhp_id: "...", locis_id: "..."}
    -- Meta
    verified        BOOLEAN DEFAULT false,       -- admin-verified
    created_by      UUID,                        -- FK to users (nullable for seed data)
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sites_geom ON sites USING GIST(geom);
CREATE INDEX idx_sites_type ON sites(site_type);
CREATE INDEX idx_sites_status ON sites(status);
CREATE INDEX idx_sites_built ON sites(built_year);
CREATE INDEX idx_sites_country_state ON sites(country, state_province);

-- Many-to-many: a depot can be on multiple railroads (Union stations)
CREATE TABLE site_railroads (
    site_id     UUID REFERENCES sites(id) ON DELETE CASCADE,
    railroad_id UUID REFERENCES railroads(id) ON DELETE CASCADE,
    PRIMARY KEY (site_id, railroad_id)
);

-- =============================================================================
-- PHOTOS — images attached to sites
-- =============================================================================
CREATE TABLE photos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id         UUID REFERENCES sites(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,        -- CDN URL
    thumbnail_url   TEXT,
    caption         TEXT,
    photographer    TEXT,
    taken_year      INTEGER,              -- when the photo was shot
    is_historic     BOOLEAN DEFAULT false, -- pre-1970 or clearly vintage
    license         TEXT,                 -- "CC-BY", "public domain", "fair use"
    source_url      TEXT,                 -- where it came from
    uploaded_by     UUID,                 -- FK to users
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_photos_site ON photos(site_id);

-- =============================================================================
-- SOURCES — citations, where info came from
-- =============================================================================
CREATE TABLE sources (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id         UUID REFERENCES sites(id) ON DELETE CASCADE,
    kind            TEXT,                 -- "book", "newspaper", "website", "archive", "oral_history"
    citation        TEXT NOT NULL,        -- full citation text
    url             TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sources_site ON sources(site_id);

-- =============================================================================
-- USERS — contributors
-- =============================================================================
CREATE TYPE user_role AS ENUM ('visitor', 'contributor', 'moderator', 'admin');

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    role            user_role NOT NULL DEFAULT 'contributor',
    bio             TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    last_seen_at    TIMESTAMPTZ
);
CREATE INDEX idx_users_email ON users(email);

-- =============================================================================
-- EDITS — audit log for moderation and rollback
-- =============================================================================
CREATE TABLE edits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type     TEXT NOT NULL,        -- "site", "line", "railroad"
    entity_id       UUID NOT NULL,
    user_id         UUID REFERENCES users(id),
    action          TEXT NOT NULL,        -- "create", "update", "delete"
    diff            JSONB,                -- before/after
    status          TEXT NOT NULL DEFAULT 'approved',  -- "pending", "approved", "rejected"
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_edits_entity ON edits(entity_type, entity_id);
CREATE INDEX idx_edits_status ON edits(status);
CREATE INDEX idx_edits_user ON edits(user_id);

-- =============================================================================
-- HISTORIC_MAPS — scanned map layers for overlay (OldMapsOnline-style)
-- =============================================================================
CREATE TABLE historic_maps (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    publisher       TEXT,                 -- "Sanborn", "USGS", "Rand McNally"
    published_year  INTEGER,
    map_scale       TEXT,                 -- "1:24000"
    bbox            GEOMETRY(Polygon, 4326) NOT NULL,  -- coverage area
    tile_url        TEXT,                 -- {z}/{x}/{y} template, IIIF, or PMTiles
    thumbnail_url   TEXT,
    source          TEXT,                 -- "Library of Congress"
    source_url      TEXT,
    license         TEXT DEFAULT 'public domain',
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_historic_maps_bbox ON historic_maps USING GIST(bbox);
CREATE INDEX idx_historic_maps_year ON historic_maps(published_year);

-- =============================================================================
-- Convenience view: sites as GeoJSON-ready rows for the API
-- =============================================================================
CREATE OR REPLACE VIEW sites_geojson AS
SELECT
    s.id,
    s.name,
    s.site_type,
    s.status,
    s.built_year,
    s.closed_year,
    s.demolished_year,
    s.city,
    s.state_province,
    s.country,
    s.description,
    ST_Y(s.geom) AS lat,
    ST_X(s.geom) AS lng,
    COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS railroads,
    (SELECT COUNT(*) FROM photos p WHERE p.site_id = s.id) AS photo_count
FROM sites s
LEFT JOIN site_railroads sr ON sr.site_id = s.id
LEFT JOIN railroads r ON r.id = sr.railroad_id
GROUP BY s.id;
