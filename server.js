require('dotenv').config();
const express = require('express');
const loyverse = require('./modules/loyverse');
const stripe = require('./modules/stripe');
const sms = require('./modules/sms');
const email = require('./modules/email');
const TinyURL = require('tinyurl');
const cron = require('node-cron');
const retellModule = require('./modules/retell');

const app = express();
app.use(express.json());

// [Fix] In-memory storage to prevent duplicate orders from the same call
// In production, use Redis. For this MVP, a Map is sufficient.
const processedCalls = new Map();

// [Configuration]
const RETELL_KB_ID = process.env.RETELL_KB_ID;

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

/* ============================================================
   FEATURE: Menu Automation Dashboard & Scheduler
   ============================================================ */

// 1. Helper Function: Fetch & Update
async function performMenuUpdate() {
    try {
        console.log(">> Starting Scheduled/Manual Menu Update...");

        // A. Fetch from Loyverse
        const menuItems = await loyverse.getFullMenu();
        if (menuItems.length === 0) throw new Error("No items found in Loyverse.");

        // B. Format Text
        const menuText = menuItems
            .map(item => `- ${item.name} (${item.price.toFixed(2)})`)
            .join('\n');

        // C. Push to Retell
        await retellModule.updateMenuInKB(RETELL_KB_ID, menuText);

        return { success: true, itemCount: menuItems.length };
    } catch (error) {
        console.error("Menu Update Failed:", error);
        return { success: false, error: error.message };
    }
}

// 2. Scheduler: Run every day at 9:00 AM
cron.schedule('0 9 * * *', async () => {
    console.log("[Cron] Executing Daily Menu Update...");
    await performMenuUpdate();
});

// 3. UI Route: Dashboard to View Menu & Manually Trigger Update
app.get('/menu-dashboard', async (req, res) => {
    const menuItems = await loyverse.getFullMenu();
    const menuText = menuItems.map(item => `${item.name} - ${item.price}`).join('<br>');

    const html = `
    <html>
      <head>
        <title>JM Cafe Menu Automation</title>
        <style>
          body { font-family: sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          h1 { color: #333; }
          .box { border: 1px solid #ddd; padding: 20px; border-radius: 8px; background: #f9f9f9; }
          button { background: #007bff; color: white; border: none; padding: 15px 30px; font-size: 18px; border-radius: 5px; cursor: pointer; }
          button:hover { background: #0056b3; }
          button:disabled { background: #ccc; }
          #status { margin-top: 20px; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>JM Cafe Menu Automation</h1>

        <div class="box">
            <h3>Manual Update</h3>
            <p>Click below to immediately fetch the latest menu from Loyverse and push it to Retell AI.</p>
            <button id="updateBtn" onclick="triggerUpdate()">Update AI Knowledge Base Now</button>
            <div id="status"></div>
        </div>

        <br>

        <div class="box">
            <h3>Current Menu (Live from POS)</h3>
            <div style="max-height: 400px; overflow-y: auto; background: white; padding: 10px; border: 1px solid #eee;">
                ${menuText || "No items found."}
            </div>
        </div>

        <script>
            async function triggerUpdate() {
                const btn = document.getElementById('updateBtn');
                const status = document.getElementById('status');

                btn.disabled = true;
                btn.innerText = "Updating... Please wait...";
                status.innerText = "";

                try {
                    const res = await fetch('/api/trigger-menu-update', { method: 'POST' });
                    const data = await res.json();

                    if (data.success) {
                        status.style.color = "green";
                        status.innerText = "Success! AI Knowledge Base updated with " + data.itemCount + " items.";
                        btn.innerText = "Update Complete";
                    } else {
                        throw new Error(data.error);
                    }
                } catch (e) {
                    status.style.color = "red";
                    status.innerText = "Error: " + e.message;
                    btn.innerText = "Try Again";
                } finally {
                    setTimeout(() => { btn.disabled = false; if(btn.innerText === "Update Complete") btn.innerText = "Update AI Knowledge Base Now"; }, 3000);
                }
            }
        </script>
      </body>
    </html>
    `;
    res.send(html);
});

// 4. API Route: Called by the button
app.post('/api/trigger-menu-update', async (req, res) => {
    const result = await performMenuUpdate();
    res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
