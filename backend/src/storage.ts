import { createClient } from '@supabase/supabase-js';

// Supabase Storage client (service-role — server-only, bypasses Storage RLS).
// Replaces the previous Cloudflare R2 / S3 integration.
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
);

export const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'site-photos';

const PUBLIC_PREFIX =
    `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/`;

// Upload a WebP buffer to the bucket and return its public URL.
export async function uploadWebp(path: string, body: Buffer): Promise<string> {
    const { error } = await supabase.storage.from(BUCKET)
        .upload(path, body, { contentType: 'image/webp', upsert: false });
    if (error) throw error;
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Map a stored public URL back to its object path (null if it isn't ours).
export function pathFromPublicUrl(url: string): string | null {
    return url.startsWith(PUBLIC_PREFIX) ? url.slice(PUBLIC_PREFIX.length) : null;
}

// Best-effort delete of objects given their public URLs.
export async function removeByPublicUrls(urls: string[]): Promise<void> {
    const paths = urls.map(pathFromPublicUrl).filter((p): p is string => Boolean(p));
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}
