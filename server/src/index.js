require("dotenv").config();
const express = require("express");
const { PORT } = require("./config");
const store = require("./store");
const stripe = require("./stripe");
const auth = require("./auth");

const app = express();

// Stripe needs the raw, unparsed body to verify the webhook signature —
// this route must be registered before the global express.json() below.
app.post("/webhook/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.verifyWebhook(req.body, req.headers["stripe-signature"]);
  } catch (err) {
    return res.status(400).send(`webhook signature check failed: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await store.linkCheckoutSession(session.client_reference_id, {
        stripeCustomerId: session.customer,
        email: session.customer_details?.email,
      });
      await store.setPlanByCustomerId(session.customer, {
        plan: "pro",
        stripeSubscriptionId: session.subscription,
      });
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      await store.setPlanByCustomerId(subscription.customer, { plan: "free" });
    }
    res.json({ received: true });
  } catch (err) {
    console.error("webhook handling failed:", err);
    res.status(500).json({ error: "internal error handling webhook" });
  }
});

app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/auth/request-code", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "a valid email is required" });
  const result = await auth.requestCode(email);
  if (!result.ok) return res.status(429).json({ error: result.reason });
  res.json({ ok: true });
});

app.post("/auth/verify", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  const deviceIdHint = req.body?.deviceId || null;
  const kind = req.body?.kind === "web" ? "web" : "cli";
  if (!EMAIL_RE.test(email) || !code) return res.status(400).json({ error: "email and code are required" });

  const result = await auth.verifyCode(email, code, { deviceIdHint, kind });
  if (!result.ok) return res.status(401).json({ error: result.reason });
  res.json({ token: result.token, email: result.account.email, plan: result.account.plan });
});

app.get("/auth/session", async (req, res) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const account = await auth.checkSession(token);
  if (!account) return res.status(401).json({ error: "not logged in" });
  res.json({ email: account.email, plan: account.plan });
});

app.post("/usage/check", async (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });
  const usage = await store.getAccountUsage(deviceId);
  res.json({
    ...usage,
    upgradeUrl: stripe.isConfigured() ? `/checkout?deviceId=${encodeURIComponent(deviceId)}` : null,
  });
});

app.post("/usage/consume", async (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "deviceId is required" });
  const result = await store.consume(deviceId);
  if (!result.allowed && stripe.isConfigured()) {
    result.upgradeUrl = `/checkout?deviceId=${encodeURIComponent(deviceId)}`;
  }
  res.json(result);
});

app.get("/checkout", async (req, res) => {
  const { deviceId, email } = req.query;
  if (!deviceId) return res.status(400).send("deviceId is required");
  try {
    const url = await stripe.createCheckoutSession(deviceId, email);
    res.redirect(303, url);
  } catch (err) {
    res.status(501).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`bumper usage server listening on :${PORT}`);
  console.log(stripe.isConfigured() ? "stripe: configured" : "stripe: not configured yet (checkout will 501)");
});
