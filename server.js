require('dotenv').config();
const express = require('express');
const loyverse = require('./modules/loyverse');
const stripe = require('./modules/stripe');
const sms = require('./modules/sms'); // Import SMS module

const app = express();
app.use(express.json());

/**
 * Retell AI Webhook Endpoint
 */
app.post('/webhook/retell', async (req, res) => {
    try {
        console.log("Incoming Request:", JSON.stringify(req.body, null, 2));

        const { action } = req.body;
        // Safely extract parameters
        const parameters = req.body.parameters || {};

        /* ============================================================
           Scenario 1: Create Order & Send SMS
           ============================================================ */
        if (action === 'create_order') {
            const { item_name, customer_phone } = parameters;
            const itemName = item_name || parameters.itemName; // Handle variable naming

            console.log(`[Order] Item: ${itemName}, Phone: ${customer_phone}`);

            // 1. Check Price from Loyverse
            let item = null;
            if (loyverse.findItemPrice) {
                item = await loyverse.findItemPrice(itemName);
            }
            
            // Fallback if item not found (for MVP testing)
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

            // 2. Generate Stripe Payment Link
            const paymentLink = await stripe.createPaymentLink(finalItemName, finalPrice, customer_phone);

            if (!paymentLink) {
                return res.json({ success: false, message: 'Failed to generate payment link.' });
            }

            // 3. Send SMS with Payment Link (New Feature)
            // (결제 링크가 포함된 문자 발송)
            if (customer_phone) {
                const message = `[JM Pizza] Here is your order link for ${finalItemName} ($${finalPrice}): ${paymentLink}`;
                await sms.sendSMS(customer_phone, message);
            }

            console.log(`[Order] Link Generated & SMS Sent: ${paymentLink}`);
            
            return res.json({
                success: true,
                content: `I've sent a text message with the secure payment link for ${finalItemName}.`,
                payment_link: paymentLink 
            });
        }

        /* ============================================================
           Scenario 2: Book Reservation
           ============================================================ */
        else if (action === 'book_reservation') {
            const { customer_name, customer_phone, date_time, party_size } = parameters;

            console.log(`[Reservation] Request for ${customer_name} (${party_size} ppl) at ${date_time}`);

            // 1. Create Receipt in Loyverse
            const result = await loyverse.createReservationReceipt(
                customer_name,
                customer_phone,
                date_time,
                party_size
            );

            // 2. Handle Success/Failure
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

        /* ============================================================
           Unknown Action
           ============================================================ */
        else {
            console.log(`[Unknown Action] ${action}`);
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