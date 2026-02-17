require('dotenv').config();
const express = require('express');
const loyverse = require('./modules/loyverse');
const stripe = require('./modules/stripe');
const sms = require('./modules/sms');
const email = require('./modules/email');
const TinyURL = require('tinyurl');

const app = express();
app.use(express.json());

// [Fix] In-memory storage to prevent duplicate orders from the same call
// In production, use Redis. For this MVP, a Map is sufficient.
const processedCalls = new Map();

app.post('/webhook/retell', async (req, res) => {
    try {
        // console.log("Incoming Request:", JSON.stringify(req.body, null, 2));

        const body = req.body;
        const action = body.action || body.name;
        const parameters = body.parameters || body.args || {};

        // [Fix] Extract Call ID to prevent duplicates
        const callId = body.call ? body.call.call_id : body.call_id;

        /* ============================================================
           Scenario 1: Create Order (With Duplicate Protection)
           ============================================================ */
        if (action === 'create_order') {

            // [Critical Fix] Check if this call already placed an order
            if (callId && processedCalls.has(callId)) {
                console.log(`[Duplicate Blocked] Call ${callId} tried to order again. Returning cached response.`);
                return res.json(processedCalls.get(callId));
            }

            const { items, customer_phone, customer_email } = parameters;
            console.log(`[Order] Call: ${callId}, Customer: ${customer_email}`);

            if (!items || !Array.isArray(items) || items.length === 0) {
                 return res.json({ success: false, message: "No items provided." });
            }

            // 1. Process Basket
            let basket = [];
            let receiptLineItems = [];
            let totalOrderName = "";

            for (const orderItem of items) {
                const itemDetails = await loyverse.findItemPrice(orderItem.name);
                if (itemDetails) {
                    const qty = orderItem.quantity || 1;
                    basket.push({ ...itemDetails, quantity: qty });
                    receiptLineItems.push({
                        variant_id: itemDetails.variant_id,
                        price: itemDetails.price,
                        quantity: qty
                    });
                    totalOrderName += `${qty}x ${itemDetails.name}, `;
                }
            }

            if (totalOrderName.length > 2) totalOrderName = totalOrderName.slice(0, -2);
            if (basket.length === 0) {
                return res.json({ success: false, message: `Couldn't find items on the menu.` });
            }

            // 2. Create Receipt
            const receiptResult = await loyverse.createReceipt(
                receiptLineItems,
                `[AI ORDER] ${customer_email || customer_phone}`
            );

            const receiptNumber = receiptResult.success ? receiptResult.receipt_number : 'Pending';
            const finalTotalPrice = receiptResult.total_money;

            // 3. Generate Link
            const longLink = await stripe.createPaymentLink("JM Cafe Order", finalTotalPrice, customer_phone);
            let shortLink = longLink;
            try { shortLink = await TinyURL.shorten(longLink); } catch (e) {}

            // 4. Notifications
            let sentChannels = [];
            if (customer_phone) {
                const smsMsg = `[JM Cafe] Order: ${totalOrderName}. Total: ${finalTotalPrice}. Pay: ${shortLink}`;
                if (await sms.sendSMS(customer_phone, smsMsg)) sentChannels.push("SMS");
            }
            if (customer_email) {
                const emailSubject = `Order Confirmation - JM Cafe`;
                let itemRows = basket.map(b => `<li>${b.quantity} x ${b.name} (${b.price})</li>`).join('');
                const emailHtml = `
                    <h2>Order Confirmation - JM Cafe</h2>
                    <ul>${itemRows}</ul>
                    <p><b>Total: ${finalTotalPrice}</b></p>
                    <p>Order #: <b>${receiptNumber}</b></p>
                    <p><a href="${shortLink}">Pay Now</a></p>
                `;
                email.sendEmail(customer_email, emailSubject, emailHtml);
                sentChannels.push("Email");
            }

            // [Fix] AI Response Instruction
            // Explicitly tell the AI NOT to read the link.
            const responseData = {
                success: true,
                content: `Order successfully placed (Receipt #${receiptNumber}). Total: ${finalTotalPrice}. Notifications sent via ${sentChannels.join(' and ')}.
                          IMPORTANT: Tell the user you have sent the receipt and payment link to their phone/email.
                          DO NOT read the HTTP link URL out loud. Just ask if they need anything else.`,
                payment_link: shortLink
            };

            // [Critical Fix] Save this response for this Call ID
            if (callId) {
                processedCalls.set(callId, responseData);
            }

            return res.json(responseData);
        }

        /* ============================================================
           Scenario 2: Book Reservation
           ============================================================ */
        else if (action === 'book_reservation') {
            const { customer_name, customer_email, date_time, party_size } = parameters;
            let reservationItem = await loyverse.findItemPrice('Reservation');

            if (!reservationItem) return res.json({ success: false, message: "System error." });

            const result = await loyverse.createReceipt(
                [{ variant_id: reservationItem.variant_id, price: 0, quantity: 1 }],
                `[RESERVATION]\nName: ${customer_name}\nTime: ${date_time}\nPax: ${party_size}`
            );

            if (customer_email) {
                 const emailSubject = `Reservation Confirmed - JM Cafe`;
                 const emailHtml = `<h2>Confirmed!</h2><p>${date_time}, ${party_size} people</p>`;
                 email.sendEmail(customer_email, emailSubject, emailHtml);
            }

            return res.json({
                success: true,
                message: `Reservation confirmed for ${customer_name}. Receipt #${result.receipt_number}.`
            });
        }
        else {
            return res.json({ success: false, message: `Unknown action` });
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
