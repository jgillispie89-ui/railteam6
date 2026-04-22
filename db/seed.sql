-- Iron Roads seed data
-- Example sites in Kentucky/Ohio for initial prototype
-- IMPORTANT: Coordinates and dates below are approximate/illustrative.
-- Verify against primary sources (local historical societies, Sanborn maps,
-- USGS topos) before treating any of this as authoritative.

-- =============================================================================
-- RAILROADS
-- =============================================================================
INSERT INTO railroads (id, name, abbreviation, founded_year, dissolved_year, country, wikipedia_url) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Louisville and Nashville Railroad', 'L&N', 1850, 1982, 'US',
     'https://en.wikipedia.org/wiki/Louisville_and_Nashville_Railroad'),
    ('22222222-2222-2222-2222-222222222222', 'Chesapeake and Ohio Railway', 'C&O', 1869, 1987, 'US',
     'https://en.wikipedia.org/wiki/Chesapeake_and_Ohio_Railway'),
    ('33333333-3333-3333-3333-333333333333', 'Cincinnati Southern Railway', 'CSR', 1869, NULL, 'US',
     'https://en.wikipedia.org/wiki/Cincinnati_Southern_Railway'),
    ('44444444-4444-4444-4444-444444444444', 'Kentucky Central Railroad', 'KC', 1849, 1891, 'US', NULL),
    ('55555555-5555-5555-5555-555555555555', 'CSX Transportation', 'CSX', 1980, NULL, 'US',
     'https://en.wikipedia.org/wiki/CSX_Transportation');

-- Successor relationship: L&N and C&O both rolled into CSX
UPDATE railroads SET successor_id = '55555555-5555-5555-5555-555555555555'
WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- =============================================================================
-- SITES — depots, bridges, tunnels
-- =============================================================================

-- Falmouth, KY area (the user is in Falmouth — start local!)
INSERT INTO sites (id, name, site_type, status, geom, built_year, closed_year, demolished_year,
                   city, state_province, country, description, architectural_style, verified) VALUES
    ('a0000001-0000-0000-0000-000000000001',
     'Falmouth L&N Depot',
     'depot', 'destroyed',
     ST_SetSRID(ST_MakePoint(-84.3294, 38.6770), 4326),
     1869, 1971, 1978,
     'Falmouth', 'KY', 'US',
     'Wooden Queen Anne style depot served Falmouth until passenger service ended in 1971. Demolished in the late 1970s; site is near the current rail corridor through downtown.',
     'Queen Anne', false),

    ('a0000001-0000-0000-0000-000000000002',
     'Licking River Bridge (Falmouth)',
     'bridge', 'active',
     ST_SetSRID(ST_MakePoint(-84.3260, 38.6795), 4326),
     1888, NULL, NULL,
     'Falmouth', 'KY', 'US',
     'Steel through-truss bridge carrying the CSX line (former L&N) over the Licking River. Rebuilt multiple times; current superstructure is mid-20th century on original piers.',
     NULL, false);

INSERT INTO site_railroads (site_id, railroad_id) VALUES
    ('a0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
    ('a0000001-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111'),
    ('a0000001-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555');

-- Cincinnati Union Terminal
INSERT INTO sites (id, name, site_type, status, geom, built_year, city, state_province, country,
                   description, architectural_style, architect, verified) VALUES
    ('a0000002-0000-0000-0000-000000000001',
     'Cincinnati Union Terminal',
     'depot', 'preserved',
     ST_SetSRID(ST_MakePoint(-84.5370, 39.1099), 4326),
     1933, 'Cincinnati', 'OH', 'US',
     'Art Deco masterpiece and one of the finest surviving American railroad stations. Now the Cincinnati Museum Center. Served seven railroads at its peak. Added to the National Register of Historic Places in 1972.',
     'Art Deco', 'Fellheimer & Wagner', true);

-- Maysville, KY — C&O depot
INSERT INTO sites (id, name, site_type, status, geom, built_year, closed_year,
                   city, state_province, country, description, architectural_style, verified) VALUES
    ('a0000003-0000-0000-0000-000000000001',
     'Maysville C&O Depot',
     'depot', 'preserved',
     ST_SetSRID(ST_MakePoint(-83.7510, 38.6410), 4326),
     1889, 1971,
     'Maysville', 'KY', 'US',
     'Brick Italianate passenger station. Passenger service ended in 1971; building survives and has been repurposed.',
     'Italianate', false);

-- Paris, KY — L&N station (demolished)
INSERT INTO sites (id, name, site_type, status, geom, built_year, closed_year, demolished_year,
                   city, state_province, country, description, verified) VALUES
    ('a0000004-0000-0000-0000-000000000001',
     'Paris L&N Depot',
     'depot', 'destroyed',
     ST_SetSRID(ST_MakePoint(-84.2530, 38.2100), 4326),
     1882, 1968, 1979,
     'Paris', 'KY', 'US',
     'Two-story brick combination passenger/freight depot. Burned in 1979; some foundation stones reportedly remain at the site.',
     false);

-- Big Bend Tunnel (the John Henry tunnel!)
INSERT INTO sites (id, name, site_type, status, geom, built_year, country, state_province,
                   description, span_ft, construction_type, verified, wikipedia_url) VALUES
    ('a0000005-0000-0000-0000-000000000001',
     'Big Bend Tunnel',
     'tunnel', 'active',
     ST_SetSRID(ST_MakePoint(-80.7870, 37.6280), 4326),
     1872, 'US', 'WV',
     'The legendary tunnel associated with the ballad of John Henry. Built 1870-1872 on the C&O line. Still in use by CSX.',
     6450, 'rock bore', true,
     'https://en.wikipedia.org/wiki/Big_Bend_Tunnel');

-- Cincinnati Southern Bridge over the Ohio River
INSERT INTO sites (id, name, site_type, status, geom, built_year, city, state_province, country,
                   description, span_ft, construction_type, verified) VALUES
    ('a0000006-0000-0000-0000-000000000001',
     'Cincinnati Southern Railway Bridge',
     'bridge', 'active',
     ST_SetSRID(ST_MakePoint(-84.5040, 39.0950), 4326),
     1877, 'Cincinnati', 'OH', 'US',
     'Single-track rail bridge over the Ohio River. Original 1877 structure replaced by the current crossing; remains the key CSR connection between Cincinnati and the South.',
     2730, 'steel truss', false);

-- Covington, KY freight yards (abandoned)
INSERT INTO sites (id, name, site_type, status, geom, built_year, closed_year,
                   city, state_province, country, description, verified) VALUES
    ('a0000007-0000-0000-0000-000000000001',
     'Covington L&N Freight House',
     'freight_house', 'abandoned',
     ST_SetSRID(ST_MakePoint(-84.5080, 39.0800), 4326),
     1897, 2004,
     'Covington', 'KY', 'US',
     'Brick freight house and associated yard trackage. Closed in 2004 when CSX consolidated operations.',
     false);

-- A destroyed bridge — Licking River trestle (historical)
INSERT INTO sites (id, name, site_type, status, geom, built_year, closed_year, demolished_year,
                   city, state_province, country, description, construction_type, verified) VALUES
    ('a0000008-0000-0000-0000-000000000001',
     'Kentucky Central Trestle (Cynthiana)',
     'trestle', 'destroyed',
     ST_SetSRID(ST_MakePoint(-84.2950, 38.3900), 4326),
     1874, 1935, 1937,
     'Cynthiana', 'KY', 'US',
     'Iron trestle carrying the Kentucky Central line over the Licking River. Washed out in the 1937 Ohio River flood and never rebuilt. Pier stubs reportedly visible at low water.',
     'iron trestle', false);

INSERT INTO site_railroads (site_id, railroad_id) VALUES
    ('a0000002-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
    ('a0000002-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
    ('a0000003-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
    ('a0000004-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
    ('a0000005-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
    ('a0000006-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333'),
    ('a0000007-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
    ('a0000008-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444');

-- =============================================================================
-- A sample line (abandoned corridor)
-- =============================================================================
INSERT INTO lines (id, name, railroad_id, status, built_year, abandoned_year, removed_year,
                   length_miles, gauge_mm, geom, description) VALUES
    ('b0000001-0000-0000-0000-000000000001',
     'Kentucky Central main line (Paris–Maysville branch segment)',
     '44444444-4444-4444-4444-444444444444',
     'abandoned',
     1854, 1988, 1995,
     42.5, 1435,
     ST_GeomFromText('LINESTRING(-84.2530 38.2100, -84.1800 38.3200, -84.0500 38.4500, -83.9200 38.5500, -83.7510 38.6410)', 4326),
     'Portions of the old Kentucky Central main line in the Bluegrass region. Track lifted in the 1990s; much of the corridor survives as fields or unrecognized cuts.');
