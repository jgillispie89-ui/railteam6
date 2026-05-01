import { Resend } from 'resend';

// Migrated from Yahoo SMTP (nodemailer) to Resend on 2026-05-01.
// Domain railteam6.com is verified at resend.com; set RESEND_API_KEY and
// RESEND_FROM_EMAIL (e.g. noreply@railteam6.com) in your environment.

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM         = `RailTeam6 <${process.env.RESEND_FROM_EMAIL || 'noreply@railteam6.com'}>`;
const REPLY_TO     = 'americapartypodcast@gmail.com';
const BASE         = process.env.FRONTEND_URL || 'https://railteam6.com';
const ADMIN_NOTIFY = process.env.ADMIN_NOTIFY_EMAIL || 'americapartypodcast@gmail.com';

// Retry only on transient (5xx / network) errors; bail immediately on 4xx.
async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
    let lastErr!: Error;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastErr = err;
            const status: number | undefined = err?.statusCode ?? err?.status;
            console.error(
                `[email] ${label} attempt ${attempt}/${maxAttempts} failed:`,
                err.message,
                status ? `(HTTP ${status})` : ''
            );
            // Don't retry client errors (4xx) — they won't resolve with retrying
            if (status && status >= 400 && status < 500) break;
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw lastErr;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
    const link = `${BASE}/verify?token=${token}`;
    await withRetry(async () => {
        const { error } = await resend.emails.send({
            from:     FROM,
            to:       [to],
            replyTo:  REPLY_TO,
            subject:  'Verify your RailTeam6 email',
            text: [
                `Hi,`,
                ``,
                `Thanks for joining RailTeam6! Click the link below to verify your email address:`,
                ``,
                link,
                ``,
                `This link expires in 48 hours. If you didn't create an account, you can ignore this email.`,
                ``,
                `— The RailTeam6 team`,
            ].join('\n'),
        });
        if (error) throw Object.assign(new Error(error.message), { statusCode: (error as any).statusCode });
    }, `verification to ${to}`);
    console.log(`[email] Verification email sent successfully to ${to}`);
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const link = `${BASE}/reset-password?token=${token}`;
    await withRetry(async () => {
        const { error } = await resend.emails.send({
            from:     FROM,
            to:       [to],
            replyTo:  REPLY_TO,
            subject:  'Reset your RailTeam6 password',
            text: [
                `Hi,`,
                ``,
                `We received a request to reset your RailTeam6 password. Click the link below to set a new one:`,
                ``,
                link,
                ``,
                `This link expires in 1 hour. If you didn't request a password reset, you can ignore this email — your password will not change.`,
                ``,
                `— The RailTeam6 team`,
            ].join('\n'),
        });
        if (error) throw Object.assign(new Error(error.message), { statusCode: (error as any).statusCode });
    }, `password reset to ${to}`);
    console.log(`[email] Password reset email sent successfully to ${to}`);
}

export async function sendAdminNotificationEmail(email: string, userId: string): Promise<void> {
    const timestamp = new Date().toUTCString();
    const adminLink = `${BASE}/admin/users/${userId}`;
    await withRetry(async () => {
        const { error } = await resend.emails.send({
            from:    FROM,
            to:      [ADMIN_NOTIFY],
            subject: `New RailTeam6 signup: ${email}`,
            text: [
                `A new user just registered on RailTeam6.`,
                ``,
                `Email: ${email}`,
                `Registered: ${timestamp}`,
                `Admin link: ${adminLink}`,
                ``,
                `— RailTeam6 automated alert`,
            ].join('\n'),
        });
        if (error) throw Object.assign(new Error(error.message), { statusCode: (error as any).statusCode });
    }, `admin notification for ${email}`);
}
