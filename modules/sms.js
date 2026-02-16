const twilio = require('twilio');
require('dotenv').config();

// Load Twilio Credentials
// (Twilio 인증 정보 로드)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

// Initialize Client safely
// (클라이언트 안전 초기화)
const client = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

/**
 * Send SMS
 * (SMS 발송 함수)
 * @param {string} toPhone - Recipient phone number (+1 format)
 * @param {string} message - Message content
 */
async function sendSMS(toPhone, message) {
    if (!client) {
        console.error("[SMS] Twilio credentials missing. Skipped.");
        return false;
    }
    try {
        const result = await client.messages.create({
            body: message,
            from: fromNumber,
            to: toPhone
        });
        console.log(`[SMS] Sent to ${toPhone}: ${result.sid}`);
        return true;
    } catch (error) {
        console.error(`[SMS] Failed to send: ${error.message}`);
        return false;
    }
}

module.exports = { sendSMS };
