require('dotenv').config();
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

async function createPaymentLink(productName, priceAmount, customerPhone) {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: productName,
            },
            unit_amount: Math.round(priceAmount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        customer_phone: customerPhone,
      },
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    });

    return session.url;
  } catch (error) {
    console.error(`[Stripe] createPaymentLink failed: ${error.message}`);
    return null;
  }
}

module.exports = { createPaymentLink };
