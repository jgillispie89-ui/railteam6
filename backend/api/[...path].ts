// Vercel catch-all function: handles every /api/* request (at any depth) and
// lets the Express app do the routing.
//
// Why the wrapper instead of `export default app`: Vercel routes all /api/*
// requests here and exposes the matched path segments as `req.query.path`, but it
// does NOT reliably set `req.url` to the full original path for nested routes —
// so `/api/health` worked while `/api/health/db` 404'd inside Express. We rebuild
// `req.url` to the canonical `/api/<segments>` form (preserving any real query
// string) so Express matches every route regardless of nesting depth.
import app from '../dist/app.js';

export default function handler(req: any, res: any) {
    const segs = req.query?.path;
    if (segs != null) {
        const path = '/api/' + (Array.isArray(segs) ? segs.join('/') : segs);
        let query = '';
        const qIndex = typeof req.url === 'string' ? req.url.indexOf('?') : -1;
        if (qIndex !== -1) {
            const params = new URLSearchParams(req.url.slice(qIndex + 1));
            params.delete('path'); // drop Vercel's injected catch-all param
            const qs = params.toString();
            query = qs ? `?${qs}` : '';
        }
        req.url = path + query;
    }
    return app(req, res);
}
