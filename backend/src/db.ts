import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pkg;

const _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
});

// Neon free-tier computes auto-suspend and return "Control plane request failed"
// on the first query while waking up. Retry up to 3x with backoff.
const isTransient = (err: any) =>
    err?.message?.includes('Control plane request failed') ||
    err?.message?.includes('endpoint is disabled') ||
    err?.code === 'ECONNRESET';

export const pool = {
    query: async (text: any, values?: any): Promise<pkg.QueryResult<any>> => {
        for (let i = 0; i < 3; i++) {
            try {
                return await _pool.query(text, values);
            } catch (err: any) {
                if (isTransient(err) && i < 2) {
                    await new Promise(r => setTimeout(r, 600 * (i + 1)));
                    continue;
                }
                throw err;
            }
        }
        throw new Error('unreachable');
    },
};
