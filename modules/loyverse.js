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

// [New] 매장 ID를 자동으로 가져오는 함수
async function getStoreId() {
    try {
        const response = await apiClient.get('/stores');
        // 첫 번째 매장의 ID를 반환
        if (response.data.stores && response.data.stores.length > 0) {
            return response.data.stores[0].id;
        }
        return null;
    } catch (error) {
        console.error('[Loyverse] Failed to fetch Store ID:', error.message);
        return null;
    }
}

// 1. 상품(Variant) ID 찾기
async function findItemPrice(itemName) {
    try {
        let cursor = null;
        do {
            const url = cursor ? `/variants?cursor=${cursor}` : '/variants';
            const response = await apiClient.get(url);
            
            // Loyverse API 구조상 /variants 호출 시 items 정보가 없을 수 있어 /items를 별도로 호출하거나
            // 단순화를 위해 variant 이름 매칭을 시도할 수 있으나, 여기서는 기존 로직 유지하되 안전장치 추가
            const variants = response.data.variants || [];
            const items = response.data.items || []; // items가 없으면 빈 배열

            // 1차 시도: variants 목록에서 찾기 (Variant 이름이나 Item 이름 매칭)
            // 주의: /variants 엔드포인트는 보통 item_name을 포함하지 않을 수 있음. 
            // MVP를 위해 items가 없으면 넘어가고, 있으면 검색
            if (items.length > 0) {
                const found = variants.find(v => 
                    items.find(i => i.id === v.item_id)?.item_name.toLowerCase().includes(itemName.toLowerCase())
                );
                if (found) return found;
            } else {
                 // items 데이터가 없는 경우(API 특성), MVP용으로 그냥 첫번째 variant라도 리턴하거나 null 처리
                 // 여기서는 Reservation이라는 이름이 중요하므로, items를 못 가져오면 실패 처리
            }

            cursor = response.data.cursor || null;
        } while (cursor);

        return null;
    } catch (error) {
        console.error(`[Loyverse] findItemPrice failed: ${error.message}`);
        return null;
    }
}

// 2. 예약 영수증 생성 (핵심 기능 수정됨)
async function createReservationReceipt(customerName, customerPhone, dateTime, partySize) {
    try {
        // A. 매장 ID 자동 확보
        const storeId = await getStoreId();
        if (!storeId) {
            console.error('[Loyverse] No store found. Cannot create receipt.');
            return { success: false, message: "Store ID not found." };
        }

        // B. 'Reservation' 아이템 찾기
        // (주의: findItemPrice가 실패하면 Reservation 상품을 못 찾은 것)
        // MVP 팁: 만약 findItemPrice가 자꾸 실패하면, 아래 variantId에 사장님 Loyverse 상품 ID를 하드코딩해도 됩니다.
        const reservationItem = await findItemPrice('Reservation');
        
        // 안전장치: 못 찾으면 그냥 진행하지 않고 에러 리턴
        if (!reservationItem || !reservationItem.variant_id) {
            console.error('[Loyverse] "Reservation" item not found in catalog. Check item name.');
            return { success: false, message: "Reservation item missing in POS." };
        }

        const variantId = reservationItem.variant_id;

        // C. 영수증 데이터 구성 (Payload 강화)
        const payload = {
            receipt_type: "SALE",
            store_id: storeId, // [중요] 매장 ID 다시 추가
            total_money: 0,    // [중요] 0원임을 명시
            line_items: [
                {
                    variant_id: variantId,
                    quantity: 1,
                    price: 0,
                    note: `Party: ${partySize}`
                }
            ],
            // 결제 정보(Empty)를 보내야 400 에러가 안 날 수 있음
            payments: [], 
            note: `[RESERVATION]\nName: ${customerName}\nPhone: ${customerPhone}\nTime: ${dateTime}\nPax: ${partySize}`
        };

        const response = await apiClient.post('/receipts', payload);
        
        console.log("Reservation Created:", response.data.receipt_number);
        return { 
            success: true, 
            message: 'Reservation confirmed.', 
            receipt_number: response.data.receipt_number 
        };

    } catch (error) {
        // [중요] 에러 로그 업그레이드: Loyverse가 보낸 진짜 에러 이유를 보여줌
        const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[Loyverse] createReservationReceipt failed: ${errorDetail}`);
        return { success: false, message: 'Failed to create reservation.' };
    }
}

module.exports = { findItemPrice, createReservationReceipt };