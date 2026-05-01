import nodemailer from 'nodemailer';

// TODO: Migrate to Resend.com (https://resend.com) for reliable transactional email.
// Yahoo SMTP is unreliable: app passwords expire silently, rate limits are opaque, and
// delivery to non-Yahoo inboxes is poor. Resend offers 3,000 free emails/month via HTTP API.

const transporter = nodemailer.createTransport({
    host: 'smtp.mail.yahoo.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER || 'railteam6@yahoo.com',
        pass: process.env.EMAIL_PASS,
    },
});

const FROM         = `RailTeam6 <${process.env.EMAIL_USER || 'railteam6@yahoo.com'}>`;
const BASE         = process.env.FRONTEND_URL || 'https://railteam6.com';
const ADMIN_NOTIFY = process.env.ADMIN_NOTIFY_EMAIL || 'americapartypodcast@gmail.com';

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
    let lastErr!: Error;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastErr = err;
            console.error(
                `[email] ${label} attempt ${attempt}/${maxAttempts} failed:`,
                err.message,
                `(SMTP code: ${(err as any).responseCode ?? 'n/a'})`
            );
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw lastErr;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
    const link = `${BASE}/verify?token=${token}`;
    await withRetry(
        () => transporter.sendMail({
            from: FROM,
            to,
            subject: 'Verify your RailTeam6 email',
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
        }),
        `verification to ${to}`
    );
    console.log(`[email] Verification email sent successfully to ${to}`);
}

export async function sendAdminNotificationEmail(email: string, userId: string): Promise<void> {
    const timestamp = new Date().toUTCString();
    const adminLink = `${BASE}/admin/users/${userId}`;
    await withRetry(
        () => transporter.sendMail({
            from: FROM,
            to: ADMIN_NOTIFY,
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
        }),
        `admin notification for ${email}`
    );
}
