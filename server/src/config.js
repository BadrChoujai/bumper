const path = require("path");

module.exports = {
  PORT: Number(process.env.PORT) || 8787,
  FREE_ASKS_PER_MONTH: Number(process.env.FREE_ASKS_PER_MONTH) || 15,
  DATA_FILE: path.join(__dirname, "..", "data", "accounts.json"),

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || null,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || null,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || null,
  CHECKOUT_SUCCESS_URL: process.env.CHECKOUT_SUCCESS_URL || "https://bumper-guard.pages.dev/",
  CHECKOUT_CANCEL_URL: process.env.CHECKOUT_CANCEL_URL || "https://bumper-guard.pages.dev/#pricing",
};
