const path = require("path");

module.exports = {
  PORT: Number(process.env.PORT) || 8787,
  FREE_ASKS_PER_MONTH: Number(process.env.FREE_ASKS_PER_MONTH) || 15,
  // Early access: every logged-in account is unlimited regardless of plan.
  // The quota machinery underneath stays intact — flip this back on to
  // re-enable the 15/month cap without touching any other code.
  ENFORCE_QUOTA: process.env.ENFORCE_QUOTA === "true",
  DATA_FILE: path.join(__dirname, "..", "data", "accounts.json"),

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || null,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || null,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || null,
  CHECKOUT_SUCCESS_URL: process.env.CHECKOUT_SUCCESS_URL || "https://bumper-guard.pages.dev/",
  CHECKOUT_CANCEL_URL: process.env.CHECKOUT_CANCEL_URL || "https://bumper-guard.pages.dev/#pricing",

  RESEND_API_KEY: process.env.RESEND_API_KEY || null,
  // Sandbox sender — works with zero setup, but Resend only lets it deliver
  // to your own account email until a real domain is verified.
  EMAIL_FROM: process.env.EMAIL_FROM || "Bumper <onboarding@resend.dev>",
};
