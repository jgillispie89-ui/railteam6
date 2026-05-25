// Vercel catch-all function: handles every /api/* request and lets the Express
// app do the routing.
//
// Why a catch-all file instead of api/index.ts + a rewrite: Vercel `rewrites`
// overwrite the request path with the destination, so `destination: "/api"` made
// Express see req.url="/api" (not "/api/health") and 404 everything. A catch-all
// file is auto-routed for all /api/* paths AND preserves the original req.url
// (e.g. /api/health), which is exactly what the Express routes expect.
import app from '../dist/app.js';

export default app;
