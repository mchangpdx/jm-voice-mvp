const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE, // 'gmail'
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendEmail(toEmail, subject, htmlContent) {
    if (!toEmail) {
        console.log("[Email] No email address provided. Skipping.");
        return false;
    }

    try {
        const info = await transporter.sendMail({
            from: `"JM Pizza" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: subject,
            html: htmlContent
        });
        console.log(`[Email] Sent to ${toEmail}: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error(`[Email] Failed to send: ${error.message}`);
        return false;
    }
}

module.exports = { sendEmail };
