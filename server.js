require('dotenv').config();
const express = require('express');
const loyverse = require('./modules/loyverse');
const stripe = require('./modules/stripe');
const sms = require('./modules/sms');
const email = require('./modules/email'); // Import Email
const TinyURL = require('tinyurl');

const app = express();
app.use(express.json());

app.post('/webhook/retell', async (req, res) => {
    try {
        console.log("Incoming Request:", JSON.stringify(req.body, null, 2));

        const { action } = req.body;
        const parameters = req.body.parameters || {};

        /* ============================================================
           Scenario 1: Create Order (Hybrid: SMS + Email)
           ============================================================ */
        if (action === 'create_order') {
            const { item_name, customer_phone, customer_email } = parameters; // Accept Email
            const itemName = item_name || parameters.itemName;

            console.log(`[Order] Item: ${itemName}, Phone: ${customer_phone}, Email: ${customer_email}`);

            // 1. Check Price (Strict - no hardcoded fallback)
            const item = await loyverse.findItemPrice(itemName);
            if (!item) {
                return res.json({ success: false, message: `Sorry, I couldn't find '${itemName}' on the menu.` });
            }

            const finalPrice = item.price;
            const finalItemName = item.name || itemName;
            console.log(`[Order] Loyverse returned: ${finalItemName} = $${finalPrice}`);

            // 2. Generate Stripe Link
            const longLink = await stripe.createPaymentLink(finalItemName, finalPrice, customer_phone);
            if (!longLink) return res.json({ success: false, message: 'Failed to generate payment link.' });

            // 3. Shorten Link
            let shortLink = longLink;
            try { shortLink = await TinyURL.shorten(longLink); } catch (e) {}

            // 4. Send Notifications (Hybrid)
            let sentChannels = [];

            // A. Try SMS (Fail-safe)
            if (customer_phone) {
                const smsMsg = `[JM Pizza] Order: ${finalItemName} ($${finalPrice}). Pay here: ${shortLink}`;
                const smsResult = await sms.sendSMS(customer_phone, smsMsg);
                if (smsResult) sentChannels.push("SMS");
                else console.log("[Order] SMS failed (likely Twilio regulation), trying email...");
            }

            // B. Try Email
            if (customer_email) {
                const emailSubject = `Payment Link for your ${finalItemName}`;
                const emailHtml = `
                    <h2>Order Confirmation - JM Pizza</h2>
                    <p>You ordered: <b>${finalItemName}</b></p>
                    <p>Price: <b>$${finalPrice}</b></p>
                    <p>Click the link below to pay securely:</p>
                    <p><a href="${shortLink}" style="background-color:#4CAF50; color:white; padding:10px 20px; text-decoration:none;">Pay Now</a></p>
                    <p>Or verify receipt number later.</p>
                `;
                const emailResult = await email.sendEmail(customer_email, emailSubject, emailHtml);
                if (emailResult) sentChannels.push("Email");
            }

            // 5. Response
            let responseMsg = "";
            if (sentChannels.length > 0) {
                responseMsg = `I've sent the payment link via ${sentChannels.join(' and ')}.`;
            } else {
                // If both failed, give the link verbally as a last resort
                responseMsg = "I couldn't send the message, but the order is ready.";
            }

            return res.json({
                success: true,
                content: responseMsg,
                payment_link: shortLink 
            });
        }

        /* ============================================================
           Scenario 2: Book Reservation
           ============================================================ */
        else if (action === 'book_reservation') {
            const { customer_name, customer_phone, date_time, party_size } = parameters;
            const result = await loyverse.createReservationReceipt(customer_name, customer_phone, date_time, party_size);

            if (!result.success) {
                return res.json({ success: false, message: "I'm sorry, I couldn't access the reservation system right now." });
            }
            return res.json({ 
                success: true, 
                message: `Reservation confirmed. Number is ${result.receipt_number}.`,
                receipt_number: result.receipt_number 
            });
        }
        else {
            return res.json({ success: false, message: `Unknown action: ${action}` });
        }

    } catch (error) {
        console.error("[Server Error]", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});