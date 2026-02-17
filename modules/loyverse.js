const axios = require('axios');
require('dotenv').config();

const LOYVERSE_API_URL = 'https://api.loyverse.com/v1.0';
const TOKEN = process.env.LOYVERSE_TOKEN;

const apiClient = axios.create({
    baseURL: LOYVERSE_API_URL,
    headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
    }
});

// [Helper] Fetch Store ID
async function getStoreId() {
    try {
        const response = await apiClient.get('/stores');
        return (response.data.stores && response.data.stores.length > 0) ? response.data.stores[0].id : null;
    } catch (error) {
        console.error('[Loyverse] Failed to fetch Store ID:', error.message);
        return null;
    }
}

// [Helper] Fetch Payment Type ID (Cash)
async function getPaymentTypeId() {
    try {
        const response = await apiClient.get('/payment_types');
        const paymentTypes = response.data.payment_types;
        if (paymentTypes && paymentTypes.length > 0) return paymentTypes[0].id;
        return null;
    } catch (error) {
        console.error('[Loyverse] Failed to fetch Payment Types:', error.message);
        return null;
    }
}

/**
 * Find Item Price & Details (Fixed Price Logic)
 */
async function findItemPrice(itemName) {
    try {
        let cursor = null;
        console.log(`[Loyverse] Searching for item: "${itemName}"...`);

        do {
            const url = cursor ? `/items?cursor=${cursor}` : '/items';
            const response = await apiClient.get(url);
            const items = response.data.items || [];

            const foundItem = items.find(item =>
                item.item_name.toLowerCase().includes(itemName.toLowerCase())
            );

            if (foundItem) {
                if (foundItem.variants && foundItem.variants.length > 0) {
                    const variant = foundItem.variants[0];

                    // [Fix] Check both 'price' and 'default_price'
                    let finalPrice = variant.price;
                    if (finalPrice === undefined || finalPrice === null) {
                        finalPrice = variant.default_price;
                    }
                    // Safety fallback
                    if (finalPrice === undefined || finalPrice === null) {
                        finalPrice = 0;
                    }

                    console.log(`[Loyverse] Found: ${foundItem.item_name} (Price: ${finalPrice})`);

                    return {
                        name: foundItem.item_name,
                        price: Number(finalPrice), // Ensure it is a Number
                        variant_id: variant.variant_id
                    };
                }
            }
            cursor = response.data.cursor;
        } while (cursor);

        console.log(`[Loyverse] Item "${itemName}" not found.`);
        return null;
    } catch (error) {
        console.error(`[Loyverse] findItemPrice error: ${error.message}`);
        return null;
    }
}

/**
 * Create Reservation Receipt
 */
async function createReservationReceipt(customerName, customerPhone, dateTime, partySize) {
    try {
        const storeId = await getStoreId();
        if (!storeId) return { success: false, message: "Store ID not found." };

        // Reuse findItemPrice to find "Reservation" item
        const reservationItem = await findItemPrice('Reservation');

        if (!reservationItem) {
            console.error('[Loyverse] "Reservation" item not found.');
            return { success: false, message: "Reservation item missing in POS." };
        }

        const paymentTypeId = await getPaymentTypeId();
        if (!paymentTypeId) return { success: false, message: "No payment method found." };

        const payload = {
            receipt_type: "SALE",
            store_id: storeId,
            total_money: 0,
            line_items: [{
                variant_id: reservationItem.variant_id,
                quantity: 1,
                price: 0,
                note: `Party: ${partySize}`
            }],
            payments: [{
                payment_type_id: paymentTypeId,
                amount_money: 0
            }],
            note: `[RESERVATION]\nName: ${customerName}\nPhone: ${customerPhone}\nTime: ${dateTime}\nPax: ${partySize}`
        };

        const response = await apiClient.post('/receipts', payload);
        console.log("Reservation Success:", response.data.receipt_number);

        return {
            success: true,
            message: 'Reservation confirmed.',
            receipt_number: response.data.receipt_number
        };

    } catch (error) {
        const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[Loyverse] Create Receipt Failed: ${errorDetail}`);
        return { success: false, message: `Failed to create reservation.` };
    }
}

module.exports = { findItemPrice, createReservationReceipt };
