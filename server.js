require('dotenv').config();
const express = require('express');
const loyverse = require('./modules/loyverse');
const stripe = require('./modules/stripe');

const app = express();
app.use(express.json());

/**
 * Retell AI Webhook Endpoint
 * Retell이 "주문해줘" 또는 "예약해줘"라고 요청을 보내는 곳
 */
app.post('/webhook/retell', async (req, res) => {
    try {
        console.log("Incoming Request:", JSON.stringify(req.body, null, 2));

        const { action } = req.body;
        
        // Retell은 parameters라는 객체 안에 데이터를 담아서 보냅니다.
        // 안전하게 꺼내기 위해 없으면 빈 객체({})로 처리
        const parameters = req.body.parameters || {};

        /* ============================================================
           Scenario 1: 주문 및 결제 링크 생성 (Create Order)
           ============================================================ */
        if (action === 'create_order') {
            const { item_name, customer_phone } = parameters;
            const itemName = item_name || parameters.itemName; // 대소문자/변수명 호환성 처리

            console.log(`[Order] Item: ${itemName}, Phone: ${customer_phone}`);

            // 1. Loyverse에서 상품 가격 확인
            // (주의: modules/loyverse.js에 findItemPrice 함수가 있어야 합니다)
            const item = await loyverse.findItemPrice ? await loyverse.findItemPrice(itemName) : null;
            
            if (!item) {
                // MVP용 하드코딩 백업: 만약 Loyverse 모듈에서 못 찾으면 피자($15)로 가정
                if (itemName && itemName.toLowerCase().includes('pizza')) {
                     console.log("[Order] Using fallback price for Pizza");
                     // 백업 로직 진행
                } else {
                    return res.json({ 
                        success: false, 
                        message: `Sorry, I couldn't find '${itemName}' on the menu.` 
                    });
                }
            }

            const price = item ? item.price : 15.00; // 아이템 없으면 기본값 $15 (MVP Test)
            const finalItemName = item ? item.name : itemName;

            // 2. Stripe 결제 링크 생성
            const paymentLink = await stripe.createPaymentLink(finalItemName, price, customer_phone);

            if (!paymentLink) {
                return res.json({ success: false, message: 'Failed to generate payment link.' });
            }

            console.log(`[Order] Link Generated: ${paymentLink}`);
            
            return res.json({
                success: true,
                content: `I've sent a payment link for ${finalItemName} ($${price}) to your phone.`,
                payment_link: paymentLink 
            });
        }

        /* ============================================================
           Scenario 2: 예약 (Book Reservation) - 핵심 수정 부분
           ============================================================ */
        else if (action === 'book_reservation') {
            const { customer_name, customer_phone, date_time, party_size } = parameters;

            console.log(`[Reservation] Request for ${customer_name} (${party_size} ppl) at ${date_time}`);

            // 1. Loyverse에 0원짜리 영수증 생성 요청
            const result = await loyverse.createReservationReceipt(
                customer_name,
                customer_phone,
                date_time,
                party_size
            );

            // 2. 성공/실패 여부에 따른 정확한 응답 처리
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