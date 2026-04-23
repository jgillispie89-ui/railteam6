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

const FROM = `Iron Roads <${process.env.EMAIL_USER || 'railteam6@yahoo.com'}>`;
const BASE  = process.env.FRONTEND_URL || 'https://railteam6.com';

export async function sendVerificationEmail(to: string, token: string) {
    const link = `${BASE}/verify-email?token=${token}`;
    await transporter.sendMail({
        from: FROM, to,
        subject: 'Verify your Iron Roads account',
        html: `<h2>Welcome to Iron Roads!</h2>
               <p>Click below to verify your email — link expires in 24 hours.</p>
               <p><a href="${link}">${link}</a></p>`,
    });
}
