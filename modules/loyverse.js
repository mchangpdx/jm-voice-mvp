require('dotenv').config();
const axios = require('axios');

const LOYVERSE_TOKEN = process.env.LOYVERSE_TOKEN;
const BASE_URL = 'https://api.loyverse.com/v1.0';

const loyverseApi = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${LOYVERSE_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// Find item price by name (case-insensitive search across all items)
async function findItemPrice(itemName) {
  try {
    let cursor = null;
    const searchName = itemName.toLowerCase();

    do {
      const params = { limit: 250 };
      if (cursor) params.cursor = cursor;

      const response = await loyverseApi.get('/items', { params });
      const items = response.data.items || [];

      for (const item of items) {
        if (item.item_name && item.item_name.toLowerCase().includes(searchName)) {
          const variant = item.variants && item.variants[0];
          return {
            name: item.item_name,
            price: variant ? variant.default_price : 0,
            variant_id: variant ? variant.variant_id : null,
          };
        }
      }

      cursor = response.data.cursor || null;
    } while (cursor);

    return null;
  } catch (error) {
    console.error(`[Loyverse] findItemPrice failed: ${error.message}`);
    return null;
  }
}

// Create a reservation receipt as a workaround (using a $0 "Reservation" item)
async function createReservationReceipt(customerName, customerPhone, dateTime, partySize) {
  try {
    // Find the "Reservation" item to get its variant_id
    const reservationItem = await findItemPrice('Reservation');
    if (!reservationItem || !reservationItem.variant_id) {
      console.error('[Loyverse] "Reservation" item not found in Loyverse catalog');
      return null;
    }

    const payload = {
      receipt_type: 'SALE',
      line_items: [
        {
          variant_id: reservationItem.variant_id,
          quantity: 1,
          price: 0,
          note: `Party: ${partySize}`,
        },
      ],
      note: `[RESERVATION]\nName: ${customerName}\nPhone: ${customerPhone}\nTime: ${dateTime}`,
    };

    const response = await loyverseApi.post('/receipts', payload);
    return response.data.receipt_number || null;
  } catch (error) {
    console.error(`[Loyverse] createReservationReceipt failed: ${error.message}`);
    return null;
  }
}

module.exports = { findItemPrice, createReservationReceipt };
