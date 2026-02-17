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

// Cache Store ID to avoid repeated calls
let cachedStoreId = null;

async function getStoreId() {
    if (cachedStoreId) return cachedStoreId;
    try {
        const response = await apiClient.get('/stores');
        if (response.data.stores && response.data.stores.length > 0) {
            cachedStoreId = response.data.stores[0].id;
            return cachedStoreId;
        }
        return null;
    } catch (error) {
        console.error('[Loyverse] Failed to fetch Store ID:', error.message);
        return null;
    }
}

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
 * Find Item Price (Store-Specific Logic)
 */
async function findItemPrice(itemName) {
    try {
        const storeId = await getStoreId();
        let cursor = null;
        console.log(`[Loyverse] Searching for "${itemName}"...`);

        do {
            const url = cursor ? `/items?cursor=${cursor}` : '/items';
            const response = await apiClient.get(url);
            const items = response.data.items || [];

            // Fuzzy match name (case-insensitive)
            const foundItem = items.find(item =>
                item.item_name.toLowerCase().includes(itemName.toLowerCase())
            );

            if (foundItem) {
                if (foundItem.variants && foundItem.variants.length > 0) {
                    const variant = foundItem.variants[0];

                    // [Critical Fix] Find price for the specific store
                    let finalPrice = undefined;

                    if (variant.stores && storeId) {
                        const storeData = variant.stores.find(s => s.store_id === storeId);
                        if (storeData) {
                            finalPrice = storeData.price;
                        }
                    }

                    // Fallback to default_price if store price is missing
                    if (finalPrice === undefined || finalPrice === null) {
                        finalPrice = variant.default_price;
                    }

                    // Fallback to variant.price (rare case)
                    if (finalPrice === undefined || finalPrice === null) {
                        finalPrice = variant.price;
                    }

                    // Ensure it's a number
                    finalPrice = Number(finalPrice);

                    console.log(`[Loyverse] Found: ${foundItem.item_name} (Price: ${finalPrice})`);

                    return {
                        name: foundItem.item_name,
                        price: finalPrice,
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

async function createReservationReceipt(customerName, customerPhone, dateTime, partySize) {
    try {
        const storeId = await getStoreId();
        if (!storeId) return { success: false, message: "Store ID not found." };

        const reservationItem = await findItemPrice('Reservation');
        if (!reservationItem) {
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
