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

// [Helper] 매장 ID 가져오기
async function getStoreId() {
    try {
        const response = await apiClient.get('/stores');
        return (response.data.stores && response.data.stores.length > 0) ? response.data.stores[0].id : null;
    } catch (error) {
        console.error('[Loyverse] Failed to fetch Store ID:', error.message);
        return null;
    }
}

// [Helper] 상품 이름으로 Variant ID 찾기 (핵심 수정됨)
async function findVariantIdByItemName(targetName) {
    try {
        let cursor = null;
        do {
            // /variants가 아니라 /items를 조회해야 상품명(item_name)이 보입니다.
            const url = cursor ? `/items?cursor=${cursor}` : '/items';
            const response = await apiClient.get(url);
            
            const items = response.data.items || [];
            
            // 대소문자 무시하고 이름 비교
            const foundItem = items.find(item => 
                item.item_name.toLowerCase().trim() === targetName.toLowerCase().trim()
            );

            if (foundItem) {
                // 아이템을 찾았으면 첫 번째 옵션(Variant) ID를 반환
                if (foundItem.variants && foundItem.variants.length > 0) {
                    return foundItem.variants[0].variant_id;
                }
            }

            cursor = response.data.cursor;
        } while (cursor);

        return null; // 끝까지 못 찾음
    } catch (error) {
        console.error(`[Loyverse] findVariantIdByItemName error: ${error.message}`);
        return null;
    }
}

// 2. 예약 영수증 생성
async function createReservationReceipt(customerName, customerPhone, dateTime, partySize) {
    try {
        const storeId = await getStoreId();
        if (!storeId) return { success: false, message: "Store ID not found." };

        // 1단계: Reservation 상품의 ID 찾기
        const variantId = await findVariantIdByItemName('Reservation');
        
        if (!variantId) {
            console.error('[Loyverse] "Reservation" item not found. Please create it in Loyverse POS.');
            return { success: false, message: "Reservation item missing in POS." };
        }

        // 2단계: 영수증 생성
        const payload = {
            receipt_type: "SALE",
            store_id: storeId,
            total_money: 0, // 0원 명시
            line_items: [
                {
                    variant_id: variantId,
                    quantity: 1,
                    price: 0,
                    note: `Party: ${partySize}`
                }
            ],
            payments: [], // 빈 결제 정보
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
        return { success: false, message: `Failed to create reservation: ${error.message}` };
    }
}

// 함수 이름들을 외부에서 쓸 수 있게 내보냄
// findItemPrice는 더 이상 안 쓰지만 호환성을 위해 남겨두거나 삭제 가능.
// 여기서는 깔끔하게 필요한 것만 export 합니다.
module.exports = { createReservationReceipt, findVariantIdByItemName };