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

// [Helper 1] 매장 ID 가져오기
async function getStoreId() {
    try {
        const response = await apiClient.get('/stores');
        return (response.data.stores && response.data.stores.length > 0) ? response.data.stores[0].id : null;
    } catch (error) {
        console.error('[Loyverse] Failed to fetch Store ID:', error.message);
        return null;
    }
}

// [Helper 2] 상품 이름으로 Variant ID 찾기
async function findVariantIdByItemName(targetName) {
    try {
        let cursor = null;
        do {
            const url = cursor ? `/items?cursor=${cursor}` : '/items';
            const response = await apiClient.get(url);
            const items = response.data.items || [];
            
            const foundItem = items.find(item => 
                item.item_name.toLowerCase().trim() === targetName.toLowerCase().trim()
            );

            if (foundItem && foundItem.variants.length > 0) {
                return foundItem.variants[0].variant_id;
            }
            cursor = response.data.cursor;
        } while (cursor);
        return null;
    } catch (error) {
        console.error(`[Loyverse] findVariantIdByItemName error: ${error.message}`);
        return null;
    }
}

// [Helper 3 - New!] 결제 수단 ID 가져오기 (이게 없어서 에러가 났었습니다)
async function getPaymentTypeId() {
    try {
        const response = await apiClient.get('/payment_types');
        const paymentTypes = response.data.payment_types;
        
        // 목록이 있으면 첫 번째 결제 수단(보통 Cash)의 ID를 반환
        if (paymentTypes && paymentTypes.length > 0) {
            return paymentTypes[0].id;
        }
        return null;
    } catch (error) {
        console.error('[Loyverse] Failed to fetch Payment Types:', error.message);
        return null;
    }
}

// 2. 예약 영수증 생성 (핵심 수정)
async function createReservationReceipt(customerName, customerPhone, dateTime, partySize) {
    try {
        // A. 필요한 정보들 수집 (매장 ID, 상품 ID, 결제수단 ID)
        const storeId = await getStoreId();
        if (!storeId) return { success: false, message: "Store ID not found." };

        const variantId = await findVariantIdByItemName('Reservation');
        if (!variantId) {
            console.error('[Loyverse] "Reservation" item not found.');
            return { success: false, message: "Reservation item missing in POS." };
        }

        const paymentTypeId = await getPaymentTypeId();
        if (!paymentTypeId) {
            return { success: false, message: "No payment method found in Loyverse." };
        }

        // B. 영수증 데이터 구성 (결제 정보 완벽하게 추가)
        const payload = {
            receipt_type: "SALE",
            store_id: storeId,
            total_money: 0, 
            line_items: [
                {
                    variant_id: variantId,
                    quantity: 1,
                    price: 0,
                    note: `Party: ${partySize}`
                }
            ],
            // [수정 포인트] 결제 정보를 빈 배열[]이 아니라 확실하게 채워서 보냄
            payments: [
                {
                    payment_type_id: paymentTypeId,
                    amount_money: 0
                }
            ],
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
        // 에러 발생 시 상세 이유를 로그에 남김
        const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[Loyverse] Create Receipt Failed: ${errorDetail}`);
        return { success: false, message: `Failed to create reservation.` };
    }
}

module.exports = { createReservationReceipt, findVariantIdByItemName, getPaymentTypeId };