// Vercel serverless entry point (Path A: lift-and-shift).
// The Express app is itself a (req, res) handler, so we export it directly.
// `npm run build` (tsc) compiles src/ → dist/ before this is bundled; vercel.json
// rewrites /api/* to this single function so Express handles all routing internally.
import app from '../dist/app.js';

export default app;
