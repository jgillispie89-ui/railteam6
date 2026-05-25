// Vercel entry: a single function that ALL /api/* requests are rewritten to
// (see vercel.json: source "/api/:path*" -> destination "/api/index").
//
// Why not the catch-all api/[...path].ts: Vercel's automatic catch-all routing
// returned a Vercel-level 404 for nested paths like /api/health/db — the request
// never reached the function. An explicit rewrite to a concrete function file
// forces every depth to this handler. Vercel appends the unused :path* segments
// as req.query.path, which we use to rebuild the full /api/<segments> URL so
// Express routes correctly. If the param is absent we leave req.url untouched.
import app from '../dist/app.js';

export default function handler(req: any, res: any) {
    const p = req.query?.path;
    if (p != null && p !== '') {
        const sub = Array.isArray(p) ? p.join('/') : String(p);
        let query = '';
        const qIndex = typeof req.url === 'string' ? req.url.indexOf('?') : -1;
        if (qIndex !== -1) {
            const params = new URLSearchParams(req.url.slice(qIndex + 1));
            params.delete('path'); // drop the rewrite's injected segments param
            const qs = params.toString();
            query = qs ? `?${qs}` : '';
        }
        req.url = '/api/' + sub + query;
    }
    return app(req, res);
}
