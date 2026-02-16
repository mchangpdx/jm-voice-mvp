require('dotenv').config();
const express = require('express');
const loyverse = require('./modules/loyverse');
const stripe = require('./modules/stripe');

const app = express();
app.use(express.json());

app.post('/webhook/retell', async (req, res) => {
  const { action } = req.body;

  if (action === 'create_order') {
    const { item_name, customer_phone } = req.body.parameters;

    const item = await loyverse.findItemPrice(item_name);
    if (!item) {
      return res.json({ success: false, message: `Item "${item_name}" not found.` });
    }

    const paymentLink = await stripe.createPaymentLink(item.name, item.price, customer_phone);
    if (!paymentLink) {
      return res.json({ success: false, message: 'Failed to create payment link.' });
    }

    return res.json({ success: true, payment_link: paymentLink });

  } else if (action === 'book_reservation') {
    const { customer_name, customer_phone, date_time, party_size } = req.body.parameters;

    const receiptNumber = await loyverse.createReservationReceipt(
      customer_name,
      customer_phone,
      date_time,
      party_size
    );

    if (!receiptNumber) {
      return res.json({ success: false, message: 'Failed to create reservation.' });
    }

    return res.json({ success: true, message: 'Reservation confirmed.', receipt_number: receiptNumber });

  } else {
    return res.json({ success: false, message: `Unknown action: ${action}` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
