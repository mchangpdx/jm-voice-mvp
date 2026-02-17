require('dotenv').config();
const express = require('express');
const loyverse = require('./modules/loyverse');
const stripe = require('./modules/stripe');
const sms = require('./modules/sms');
const email = require('./modules/email');
const TinyURL = require('tinyurl');

const app = express();
app.use(express.json());

app.post('/webhook/retell', async (req, res) => {
    try {
        console.log("Incoming Request:", JSON.stringify(req.body, null, 2));

        // [Fix] Handle both manual Curl (action/parameters) and Retell (name/args)
        const body = req.body;
        const action = body.action || body.name; // Retell uses 'name'
        const parameters = body.parameters || body.args || {}; // Retell uses 'args'

        console.log(`[Processing] Action: ${action}, Params: ${JSON.stringify(parameters)}`);

        /* ============================================================
           Scenario 1: Create Order (Hybrid: SMS + Email)
           ============================================================ */
        if (action === 'create_order') {
            const { item_name, customer_phone, customer_email } = parameters;
            const itemName = item_name || parameters.itemName;

            console.log(`[Order] Item: ${itemName}, Phone: ${customer_phone}, Email: ${customer_email}`);

            // 1. Check Price from Loyverse
            let item = null;
            if (loyverse.findItemPrice) {
                item = await loyverse.findItemPrice(itemName);
            }

            // Strict Check: If item not found, return error
            if (!item) {
                console.log(`[Order] Error: Item '${itemName}' not found in Loyverse.`);
                return res.json({
                    success: false,
                    message: `Sorry, I couldn't find '${itemName}' on the menu. Please check the name.`
                });
            }

            const finalPrice = item.price;
            const finalItemName = item.name;

            // Strict Check: Validate Price for Stripe (Must be >= $0.50)
            if (!finalPrice || isNaN(finalPrice) || finalPrice < 0.50) {
                 console.log(`[Order] Error: Price (${finalPrice}) is invalid/too low.`);
                 return res.json({
                     success: false,
                     message: `Error: The price for ${finalItemName} is invalid (${finalPrice}).`
                 });
            }

            // 2. Generate Stripe Payment Link
            const longLink = await stripe.createPaymentLink(finalItemName, finalPrice, customer_phone);
            if (!longLink) {
                return res.json({ success: false, message: 'Failed to generate payment link.' });
            }

            // 3. Shorten Link
            let shortLink = longLink;
            try { shortLink = await TinyURL.shorten(longLink); } catch (e) {
                console.error("[TinyURL] Failed, using long link");
            }

            // 4. Send Notifications (Hybrid)
            let sentChannels = [];

            // A. Try SMS (Fail-safe)
            if (customer_phone) {
                const smsMsg = `[JM Pizza] Order: ${finalItemName} (${finalPrice}). Pay here: ${shortLink}`;
                const smsResult = await sms.sendSMS(customer_phone, smsMsg);
                if (smsResult) sentChannels.push("SMS");
                else console.log("[Order] SMS failed, trying email...");
            }

            // B. Try Email (Essential)
            if (customer_email) {
                const emailSubject = `Payment Link for your ${finalItemName}`;
                const emailHtml = `
                    <h2>Order Confirmation - JM Pizza</h2>
                    <p>You ordered: <b>${finalItemName}</b></p>
                    <p>Price: <b>${finalPrice}</b></p>
                    <p>Click the link below to pay securely:</p>
                    <p><a href="${shortLink}" style="background-color:#4CAF50; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Pay Now</a></p>
                    <p>Or verify receipt number later.</p>
                `;
                const emailResult = await email.sendEmail(customer_email, emailSubject, emailHtml);
                if (emailResult) sentChannels.push("Email");
            }

            let responseMsg = sentChannels.length > 0
                ? `I've sent the payment link via ${sentChannels.join(' and ')}.`
                : "I couldn't send the notification, but the order link is generated.";

            // Return success to Retell
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

        // Handle Unknown Actions
        else {
            console.log(`[Error] Unknown action/name: ${action}`);
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
