const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, CHECKOUT_SUCCESS_URL, CHECKOUT_CANCEL_URL } = require("./config");

function isConfigured() {
  return !!(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);
}

let stripeClient = null;
function client() {
  if (!STRIPE_SECRET_KEY) return null;
  if (!stripeClient) stripeClient = require("stripe")(STRIPE_SECRET_KEY);
  return stripeClient;
}

// deviceId travels through as Checkout Session client_reference_id so the
// webhook can link the resulting Stripe customer back to the free account
// that was already tracking this device, with no login step required.
async function createCheckoutSession(deviceId, email) {
  if (!isConfigured()) {
    throw new Error("Stripe isn't configured on this server yet (STRIPE_SECRET_KEY / STRIPE_PRICE_ID).");
  }
  const session = await client().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: deviceId,
    customer_email: email || undefined,
    success_url: CHECKOUT_SUCCESS_URL,
    cancel_url: CHECKOUT_CANCEL_URL,
  });
  return session.url;
}

function verifyWebhook(rawBody, signature) {
  if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET isn't set.");
  return client().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
}

module.exports = { isConfigured, createCheckoutSession, verifyWebhook };
