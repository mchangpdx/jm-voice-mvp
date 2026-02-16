# JM AI Voice Middleware - MVP

Middleware server that connects a Retell AI voice agent to Loyverse POS and Stripe for order payments and reservation booking.

## Features

- **Create Order** — Looks up item pricing from Loyverse and generates a Stripe payment link.
- **Book Reservation** — Creates a reservation receipt in Loyverse POS.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your keys:
   - `LOYVERSE_TOKEN`
   - `STRIPE_SECRET_KEY`
   - `PORT` (optional, defaults to 3000)
3. `node server.js`

## API

**POST** `/webhook/retell`

Actions:
- `create_order` — requires `item_name`, `customer_phone`
- `book_reservation` — requires `customer_name`, `customer_phone`, `date_time`, `party_size`
