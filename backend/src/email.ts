import nodemailer from 'nodemailer';

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

export async function sendVerificationEmail(to: string, token: string) {
    const link = `${BASE}/verify?token=${token}`;
    await transporter.sendMail({
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
    });
}

export async function sendAdminNotificationEmail(email: string, userId: string) {
    const timestamp = new Date().toUTCString();
    const adminLink = `${BASE}/admin/users/${userId}`;
    await transporter.sendMail({
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
    });
}
