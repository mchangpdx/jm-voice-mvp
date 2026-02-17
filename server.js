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

        const body = req.body;
        const action = body.action || body.name;
        const parameters = body.parameters || body.args || {};

        console.log(`[Processing] Action: ${action}, Params: ${JSON.stringify(parameters)}`);

        /* ============================================================
           Scenario 1: Create Order (Cart - Multiple Items)
           ============================================================ */
        if (action === 'create_order') {
            const { customer_phone, customer_email } = parameters;

            // Support both single item (item_name) and multiple items (items array)
            let itemNames = [];
            if (parameters.items && Array.isArray(parameters.items)) {
                // Cart mode: [{name: "Pizza", quantity: 2}, {name: "Coke", quantity: 1}]
                itemNames = parameters.items;
            } else {
                // Legacy single item mode
                const itemName = parameters.item_name || parameters.itemName;
                if (itemName) {
                    itemNames = [{ name: itemName, quantity: 1 }];
                }
            }

            if (itemNames.length === 0) {
                return res.json({ success: false, message: "No items specified in the order." });
            }

            console.log(`[Order] Items: ${JSON.stringify(itemNames)}, Phone: ${customer_phone}, Email: ${customer_email}`);

            // 1. Look up each item in Loyverse
            const lineItems = [];
            const notFoundItems = [];

            for (const entry of itemNames) {
                const item = await loyverse.findItemPrice(entry.name);
                if (!item) {
                    notFoundItems.push(entry.name);
                    continue;
                }

                // Validate price
                if (!item.price || isNaN(item.price) || item.price < 0.50) {
                    console.log(`[Order] Invalid price for ${item.name}: ${item.price}`);
                    notFoundItems.push(entry.name);
                    continue;
                }

                lineItems.push({
                    name: item.name,
                    price: item.price,
                    variant_id: item.variant_id,
                    quantity: entry.quantity || 1
                });
            }

            // If no valid items found
            if (lineItems.length === 0) {
                return res.json({
                    success: false,
                    message: `Sorry, I couldn't find these items: ${notFoundItems.join(', ')}`
                });
            }

            // 2. Calculate total
            let totalPrice = 0;
            lineItems.forEach(item => { totalPrice += item.price * item.quantity; });

            // Build order summary
            const orderSummary = lineItems.map(i => `${i.name} x${i.quantity} ($${i.price})`).join(', ');
            console.log(`[Order] Summary: ${orderSummary} | Total: $${totalPrice}`);

            // 3. Create Receipt in Loyverse (Cart)
            const orderNote = `[ORDER] ${orderSummary} - Phone: ${customer_phone || 'N/A'}`;
            const receiptResult = await loyverse.createReceipt(lineItems, orderNote);
            if (receiptResult.success) {
                console.log(`[Order] Loyverse Receipt: ${receiptResult.receipt_number}`);
            } else {
                console.error(`[Order] Loyverse Receipt failed: ${receiptResult.message}`);
            }

            // 4. Generate Stripe Payment Link (using total)
            const longLink = await stripe.createPaymentLink(`JM Cafe Order`, totalPrice, customer_phone);
            if (!longLink) {
                return res.json({ success: false, message: 'Failed to generate payment link.' });
            }

            // 5. Shorten Link
            let shortLink = longLink;
            try { shortLink = await TinyURL.shorten(longLink); } catch (e) {
                console.error("[TinyURL] Failed, using long link");
            }

            // 6. Send Notifications (Hybrid)
            let sentChannels = [];

            if (customer_phone) {
                const smsMsg = `[JM Cafe] Order: ${orderSummary}. Total: $${totalPrice}. Pay: ${shortLink}`;
                const smsResult = await sms.sendSMS(customer_phone, smsMsg);
                if (smsResult) sentChannels.push("SMS");
                else console.log("[Order] SMS failed, trying email...");
            }

            if (customer_email) {
                const itemsHtml = lineItems.map(i =>
                    `<li>${i.name} x${i.quantity} — $${(i.price * i.quantity).toFixed(2)}</li>`
                ).join('');

                const emailSubject = `Your JM Cafe Order - $${totalPrice.toFixed(2)}`;
                const emailHtml = `
                    <h2>Order Confirmation - JM Cafe</h2>
                    <ul>${itemsHtml}</ul>
                    <p><b>Total: $${totalPrice.toFixed(2)}</b></p>
                    ${notFoundItems.length > 0 ? `<p style="color:red;">Items not found: ${notFoundItems.join(', ')}</p>` : ''}
                    <p>Click below to pay securely:</p>
                    <p><a href="${shortLink}" style="background-color:#4CAF50; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Pay Now</a></p>
                `;
                const emailResult = await email.sendEmail(customer_email, emailSubject, emailHtml);
                if (emailResult) sentChannels.push("Email");
            }

            let responseMsg = sentChannels.length > 0
                ? `I've sent the payment link via ${sentChannels.join(' and ')}.`
                : "I couldn't send the notification, but the order link is generated.";

            // Warn about missing items
            if (notFoundItems.length > 0) {
                responseMsg += ` Note: Could not find ${notFoundItems.join(', ')}.`;
            }

            return res.json({
                success: true,
                content: responseMsg,
                payment_link: shortLink,
                total: totalPrice,
                items_found: lineItems.map(i => ({ name: i.name, qty: i.quantity, price: i.price })),
                items_not_found: notFoundItems,
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

            // 2. Create Receipt with $0 price (single item in array format)
            const reservationNote = `[RESERVATION]\nName: ${customer_name}\nPhone: ${customer_phone}\nTime: ${date_time}\nPax: ${party_size}`;
            const lineItems = [{
                variant_id: reservationItem.variant_id,
                quantity: 1,
                price: 0,
                note: `Party: ${party_size}`
            }];
            const result = await loyverse.createReceipt(lineItems, reservationNote);

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
