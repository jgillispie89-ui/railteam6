import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pkg;

const _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Enable SSL for any remote host (Supabase, Neon, etc.); disable only for local dev.
    ssl: /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL || '') ? undefined : { rejectUnauthorized: false },
    // Serverless: each function instance holds at most one client. Concurrency is
    // handled by the Supabase transaction pooler (DATABASE_URL → port 6543), and a
    // small pool avoids exhausting connections across many warm instances.
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 30000,
});

// Neon free-tier computes auto-suspend; transient errors during wake-up need patient retries.
const isTransient = (err: any) =>
    err?.message?.includes('Control plane request failed') ||
    err?.message?.includes('endpoint is disabled') ||
    err?.message?.includes('connection timeout') ||
    err?.message?.includes('Too many') ||
    err?.code === 'ECONNRESET';

// Backoff schedule: 2s, 4s, 8s, 8s, 8s = up to ~30s total
const BACKOFF = [2000, 4000, 8000, 8000, 8000];

export const pool = {
    query: async (text: any, values?: any): Promise<pkg.QueryResult<any>> => {
        for (let i = 0; i <= BACKOFF.length; i++) {
            try {
                return await _pool.query(text, values);
            } catch (err: any) {
                if (isTransient(err) && i < BACKOFF.length) {
                    console.error(`[db] Transient error (attempt ${i + 1}/${BACKOFF.length + 1}), retrying in ${BACKOFF[i] / 1000}s:`, err.message);
                    await new Promise(r => setTimeout(r, BACKOFF[i]));
                    continue;
                }
                console.error(`[db] Query failed after ${i + 1} attempt(s):`, err.message);
                throw err;
            }
        }
        throw new Error('unreachable');
    },
};
