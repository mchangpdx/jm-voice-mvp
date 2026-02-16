require('dotenv').config();
const express = require('express');
const loyverse = require('./modules/loyverse');
const stripe = require('./modules/stripe');
const sms = require('./modules/sms');
const TinyURL = require('tinyurl'); // Import TinyURL

const app = express();
app.use(express.json());

/**
 * Retell AI Webhook Endpoint
 */
app.post('/webhook/retell', async (req, res) => {
    try {
        console.log("Incoming Request:", JSON.stringify(req.body, null, 2));

        const { action } = req.body;
        const parameters = req.body.parameters || {};

        /* ============================================================
           Scenario 1: Create Order & Send Short SMS
           ============================================================ */
        if (action === 'create_order') {
            const { item_name, customer_phone } = parameters;
            const itemName = item_name || parameters.itemName;

            console.log(`[Order] Item: ${itemName}, Phone: ${customer_phone}`);

            // 1. Check Price (Loyverse)
            let item = null;
            if (loyverse.findItemPrice) {
                item = await loyverse.findItemPrice(itemName);
            }

            // Fallback
            if (!item) {
                if (itemName && itemName.toLowerCase().includes('pizza')) {
                     console.log("[Order] Item not found, using fallback price for Pizza.");
                     item = { name: "Pepperoni Pizza", price: 15.00 };
                } else {
                    return res.json({
                        success: false,
                        message: `Sorry, I couldn't find '${itemName}' on the menu.`
                    });
                }
            }

            const finalPrice = item.price;
            const finalItemName = item.name || itemName;

            // 2. Generate Stripe Payment Link (Long URL)
            const longLink = await stripe.createPaymentLink(finalItemName, finalPrice, customer_phone);

            if (!longLink) {
                return res.json({ success: false, message: 'Failed to generate payment link.' });
            }

            // 3. Shorten the Link (Fix for Twilio Error 30004)
            // (긴 링크를 단축 URL로 변환)
            let shortLink = longLink;
            try {
                shortLink = await TinyURL.shorten(longLink);
                console.log(`[Link] Shortened: ${shortLink}`);
            } catch (err) {
                console.error("[Link] Shortener failed, using long link:", err);
            }

            // 4. Send SMS with Short Link
            if (customer_phone) {
                // Keep message short!
                const message = `[JM Pizza] Order: ${finalItemName} (${finalPrice}). Pay here: ${shortLink}`;
                await sms.sendSMS(customer_phone, message);
            }

            console.log(`[Order] Completed. Link: ${shortLink}`);

            return res.json({
                success: true,
                content: `I've sent a text with the payment link for ${finalItemName}.`,
                payment_link: shortLink
            });
        }

        /* ============================================================
           Scenario 2: Book Reservation
           ============================================================ */
        else if (action === 'book_reservation') {
            const { customer_name, customer_phone, date_time, party_size } = parameters;

            console.log(`[Reservation] Request for ${customer_name} (${party_size} ppl) at ${date_time}`);

            const result = await loyverse.createReservationReceipt(
                customer_name,
                customer_phone,
                date_time,
                party_size
            );

            if (!result.success) {
                console.error(`[Reservation] Failed: ${result.message}`);
                return res.json({
                    success: false,
                    message: "I'm sorry, I couldn't access the reservation system right now."
                });
            }

            console.log(`[Reservation] Success! Receipt #: ${result.receipt_number}`);

            return res.json({
                success: true,
                message: `Reservation confirmed for ${party_size} people. Confirmation number is ${result.receipt_number}.`,
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
