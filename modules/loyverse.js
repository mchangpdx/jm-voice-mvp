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

// Helper: Find a single item's details
async function findItemPrice(itemName) {
    try {
        const storeId = await getStoreId();
        let cursor = null;

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

                    return {
                        name: foundItem.item_name,
                        price: finalPrice,
                        variant_id: variant.variant_id
                    };
                }
            }
            cursor = response.data.cursor;
        } while (cursor);
        return null;
    } catch (error) {
        console.error(`[Loyverse] findItemPrice error: ${error.message}`);
        return null;
    }
}

// [Updated] Create Receipt for Multiple Items (Cart)
async function createReceipt(lineItems, note = "") {
    try {
        const storeId = await getStoreId();
        const paymentTypeId = await getPaymentTypeId();

        if (!storeId || !paymentTypeId) return { success: false, message: "Missing Store/Payment ID" };

        // Calculate Total
        let totalMoney = 0;
        lineItems.forEach(item => {
            totalMoney += (item.price * item.quantity);
        });

        const payload = {
            receipt_type: "SALE",
            store_id: storeId,
            total_money: totalMoney,
            line_items: lineItems.map(item => ({
                variant_id: item.variant_id,
                quantity: item.quantity,
                price: item.price,
                note: item.note || ""
            })),
            payments: [{
                payment_type_id: paymentTypeId,
                amount_money: totalMoney
            }],
            note: note
        };

        const response = await apiClient.post('/receipts', payload);
        console.log(`[Loyverse] Receipt Created: ${response.data.receipt_number} (Total: ${totalMoney})`);

        return {
            success: true,
            receipt_number: response.data.receipt_number,
            total_money: totalMoney
        };

    } catch (error) {
        console.error(`[Loyverse] Create Receipt Failed: ${error.message}`);
        return { success: false, message: "Failed to create receipt" };
    }
}

module.exports = { findItemPrice, createReceipt };
