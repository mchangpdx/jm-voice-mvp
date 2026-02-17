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

async function findItemPrice(itemName) {
    try {
        const storeId = await getStoreId();
        let cursor = null;
        console.log(`[Loyverse] Searching for "${itemName}"...`);

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
                    let finalPrice = undefined;

                    if (variant.stores && storeId) {
                        const storeData = variant.stores.find(s => s.store_id === storeId);
                        if (storeData) finalPrice = storeData.price;
                    }
                    if (finalPrice === undefined) finalPrice = variant.default_price;
                    if (finalPrice === undefined) finalPrice = variant.price;

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

// [Fix] Generic function to create a receipt (for both Orders and Reservations)
async function createReceipt(itemDetails, customerInfo, note = "") {
    try {
        const storeId = await getStoreId();
        const paymentTypeId = await getPaymentTypeId();

        if (!storeId || !paymentTypeId) return { success: false, message: "Missing Store/Payment ID" };

        const payload = {
            receipt_type: "SALE",
            store_id: storeId,
            total_money: itemDetails.price, // For orders, this is real price. For reservations, likely 0.
            line_items: [{
                variant_id: itemDetails.variant_id,
                quantity: 1,
                price: itemDetails.price,
                note: note
            }],
            payments: [{
                payment_type_id: paymentTypeId,
                amount_money: itemDetails.price
            }],
            note: note
        };

        const response = await apiClient.post('/receipts', payload);
        console.log(`[Loyverse] Receipt Created: ${response.data.receipt_number}`);

        return {
            success: true,
            receipt_number: response.data.receipt_number
        };

    } catch (error) {
        console.error(`[Loyverse] Create Receipt Failed: ${error.message}`);
        return { success: false, message: error.message };
    }
}

module.exports = { findItemPrice, createReceipt };
