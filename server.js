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
        const action = body.action || body.name;
        const parameters = body.parameters || body.args || {};

        console.log(`[Processing] Action: ${action}, Params: ${JSON.stringify(parameters)}`);

        /* ============================================================
           Scenario 1: Create Order (Hybrid: SMS + Email + Loyverse Receipt)
           ============================================================ */
        if (action === 'create_order') {
            const { item_name, customer_phone, customer_email } = parameters;
            const itemName = item_name || parameters.itemName;

            console.log(`[Order] Item: ${itemName}, Phone: ${customer_phone}, Email: ${customer_email}`);

            // 1. Check Price from Loyverse
            const item = await loyverse.findItemPrice(itemName);

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

            // 2. Create Receipt in Loyverse (Fix: Orders now appear in POS)
            const orderNote = `[ORDER] ${finalItemName} - Phone: ${customer_phone || 'N/A'}`;
            const receiptResult = await loyverse.createReceipt(item, { phone: customer_phone }, orderNote);
            if (receiptResult.success) {
                console.log(`[Order] Loyverse Receipt: ${receiptResult.receipt_number}`);
            } else {
                console.error(`[Order] Loyverse Receipt failed: ${receiptResult.message}`);
            }

            // 3. Generate Stripe Payment Link
            const longLink = await stripe.createPaymentLink(finalItemName, finalPrice, customer_phone);
            if (!longLink) {
                return res.json({ success: false, message: 'Failed to generate payment link.' });
            }

            // 4. Shorten Link
            let shortLink = longLink;
            try { shortLink = await TinyURL.shorten(longLink); } catch (e) {
                console.error("[TinyURL] Failed, using long link");
            }

            // 5. Send Notifications (Hybrid)
            let sentChannels = [];

            // A. Try SMS (Fail-safe)
            if (customer_phone) {
                const smsMsg = `[JM Cafe] Order: ${finalItemName} ($${finalPrice}). Pay here: ${shortLink}`;
                const smsResult = await sms.sendSMS(customer_phone, smsMsg);
                if (smsResult) sentChannels.push("SMS");
                else console.log("[Order] SMS failed, trying email...");
            }

            // B. Try Email (Essential)
            if (customer_email) {
                const emailSubject = `Payment Link for your ${finalItemName}`;
                const emailHtml = `
                    <h2>Order Confirmation - JM Cafe</h2>
                    <p>You ordered: <b>${finalItemName}</b></p>
                    <p>Price: <b>$${finalPrice}</b></p>
                    <p>Click the link below to pay securely:</p>
                    <p><a href="${shortLink}" style="background-color:#4CAF50; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Pay Now</a></p>
                `;
                const emailResult = await email.sendEmail(customer_email, emailSubject, emailHtml);
                if (emailResult) sentChannels.push("Email");
            }

            let responseMsg = sentChannels.length > 0
                ? `I've sent the payment link via ${sentChannels.join(' and ')}.`
                : "I couldn't send the notification, but the order link is generated.";

            return res.json({
                success: true,
                content: responseMsg,
                payment_link: shortLink,
                receipt_number: receiptResult.success ? receiptResult.receipt_number : null
            });
        }

        /* ============================================================
           Scenario 2: Book Reservation (with Email)
           ============================================================ */
        else if (action === 'book_reservation') {
            const { customer_name, customer_phone, customer_email, date_time, party_size } = parameters;

            console.log(`[Reservation] Name: ${customer_name}, Email: ${customer_email}, Time: ${date_time}`);

            // 1. Find the "Reservation" item in Loyverse
            const reservationItem = await loyverse.findItemPrice('Reservation');
            if (!reservationItem) {
                return res.json({ success: false, message: "Reservation item missing in POS." });
            }

            // 2. Create Receipt with $0 price
            const reservationNote = `[RESERVATION]\nName: ${customer_name}\nPhone: ${customer_phone}\nTime: ${date_time}\nPax: ${party_size}`;
            const reservationDetails = { ...reservationItem, price: 0 }; // Override price to 0
            const result = await loyverse.createReceipt(reservationDetails, { name: customer_name, phone: customer_phone }, reservationNote);

            if (!result.success) {
                return res.json({ success: false, message: "I'm sorry, I couldn't access the reservation system right now." });
            }

            // 3. Send Confirmation Email
            if (customer_email) {
                const emailSubject = `Reservation Confirmed - JM Cafe`;
                const emailHtml = `
                    <h2>Reservation Confirmed!</h2>
                    <p>Dear <b>${customer_name}</b>,</p>
                    <p>We are excited to see you!</p>
                    <ul>
                        <li><b>Date & Time:</b> ${date_time}</li>
                        <li><b>Party Size:</b> ${party_size} people</li>
                        <li><b>Confirmation #:</b> ${result.receipt_number}</li>
                    </ul>
                    <p>See you soon at JM Cafe!</p>
                `;
                email.sendEmail(customer_email, emailSubject, emailHtml).catch(err => console.error("Email failed:", err));
            }

            return res.json({
                success: true,
                message: `Reservation confirmed for ${customer_name}. A confirmation email has been sent.`,
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
