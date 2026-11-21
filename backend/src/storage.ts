import { createClient } from '@supabase/supabase-js';

// Supabase Storage client (service-role — server-only, bypasses Storage RLS).
// The RailTeam6 bucket is PRIVATE: the browser only ever sees short-lived signed URLs.
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
);

export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'railteam6-photos';
const SIGN_SECONDS = 60 * 60 * 24 * 7; // one week

const PUBLIC_PREFIX =
    `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/`;

// Upload an image buffer and return its object path inside the bucket.
export async function uploadObject(path: string, body: Buffer, contentType = 'image/webp'): Promise<string> {
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
    if (error) throw error;
    return path;
}

// Legacy helper kept for the old public-bucket code path.
export async function uploadWebp(path: string, body: Buffer): Promise<string> {
    await uploadObject(path, body);
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Sign many object paths at once. Returns a map path -> signed URL.
export async function signPaths(paths: string[]): Promise<Record<string, string>> {
    const uniq = [...new Set(paths.filter(Boolean))];
    if (!uniq.length) return {};
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(uniq, SIGN_SECONDS);
    if (error) throw error;
    const out: Record<string, string> = {};
    for (const d of data || []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
    return out;
}

export function pathFromPublicUrl(url: string): string | null {
    return url.startsWith(PUBLIC_PREFIX) ? url.slice(PUBLIC_PREFIX.length) : null;
}

export async function removeByPublicUrls(urls: string[]): Promise<void> {
    const paths = urls.map(pathFromPublicUrl).filter((p): p is string => Boolean(p));
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}
