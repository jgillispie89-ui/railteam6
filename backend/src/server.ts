// Local development entry point only.
// In production the app is served by Vercel via api/index.ts (no app.listen()).
// Schema migrations run out-of-band via `npm run migrate` (see src/migrate.ts).
import app from './app.js';

const port = parseInt(process.env.PORT || '3001', 10);
app.listen(port, () => {
    console.log(`Iron Roads API listening on http://localhost:${port}`);
});
