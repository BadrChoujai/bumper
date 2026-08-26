const db = require("./db");
const { FREE_ASKS_PER_MONTH } = require("./config");

function startOfMonth(from = new Date()) {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function startOfNextMonth(from = new Date()) {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)).toISOString();
}

async function getOrCreate(deviceId) {
  const { rows } = await db.query(
    `insert into accounts (device_id) values ($1)
     on conflict (device_id) do update set device_id = excluded.device_id
     returning *`,
    [deviceId]
  );
  return rows[0];
}

// Read-only: current plan + remaining bumps this month, doesn't touch the counter.
// Only called for free-plan accounts — callers branch on unlimitedSnapshot() first.
async function getUsageSnapshot(accountId) {
  const period = startOfMonth();
  const { rows } = await db.query(
    `select asks_used, asks_limit from usage_periods where account_id = $1 and period_start = $2`,
    [accountId, period]
  );
  const limit = rows[0]?.asks_limit ?? FREE_ASKS_PER_MONTH;
  const used = rows[0]?.asks_used ?? 0;
  return { remaining: Math.max(0, limit - used), limit, resetAt: startOfNextMonth() };
}

// JSON can't carry Infinity (serializes to null), so non-free plans get an
// explicit `unlimited: true` flag instead — the CLI and web inbox both key
// off that, the same convention src/account.js uses client-side when no
// quota server is configured at all.
function unlimitedSnapshot(plan) {
  return { plan, unlimited: true, remaining: null, limit: null, resetAt: null };
}

// Single atomic upsert-and-conditionally-increment: the WHERE clause on the
// ON CONFLICT update makes the whole check-and-increment race-proof without
// a separate lock — two simultaneous requests can't both squeak through at
// the last bump.
async function consume(deviceId) {
  const account = await getOrCreate(deviceId);

  if (account.plan !== "free") {
    return { allowed: true, ...unlimitedSnapshot(account.plan) };
  }

  const period = startOfMonth();
  const { rows } = await db.query(
    `insert into usage_periods (account_id, period_start, asks_used, asks_limit)
     values ($1, $2, 1, $3)
     on conflict (account_id, period_start)
     do update set asks_used = usage_periods.asks_used + 1, updated_at = now()
     where usage_periods.asks_used < usage_periods.asks_limit
     returning asks_used, asks_limit`,
    [account.id, period, FREE_ASKS_PER_MONTH]
  );

  if (rows[0]) {
    const { asks_used, asks_limit } = rows[0];
    return {
      allowed: true,
      plan: account.plan,
      remaining: asks_limit - asks_used,
      limit: asks_limit,
      resetAt: startOfNextMonth(),
    };
  }

  const snapshot = await getUsageSnapshot(account.id);
  return { allowed: false, plan: account.plan, remaining: 0, limit: snapshot.limit, resetAt: snapshot.resetAt };
}

async function getAccountUsage(deviceId) {
  const account = await getOrCreate(deviceId);
  if (account.plan !== "free") return unlimitedSnapshot(account.plan);
  const snapshot = await getUsageSnapshot(account.id);
  return { plan: account.plan, ...snapshot };
}

async function linkCheckoutSession(deviceId, { stripeCustomerId, email }) {
  const { rows } = await db.query(
    `insert into accounts (device_id, stripe_customer_id, email)
     values ($1, $2, $3)
     on conflict (device_id) do update
       set stripe_customer_id = excluded.stripe_customer_id,
           email = coalesce(excluded.email, accounts.email),
           updated_at = now()
     returning *`,
    [deviceId, stripeCustomerId, email || null]
  );
  return rows[0];
}

async function setPlanByCustomerId(stripeCustomerId, { plan, stripeSubscriptionId }) {
  const { rows } = await db.query(
    `update accounts
       set plan = $2,
           stripe_subscription_id = coalesce($3, stripe_subscription_id),
           updated_at = now()
     where stripe_customer_id = $1
     returning *`,
    [stripeCustomerId, plan, stripeSubscriptionId ?? null]
  );
  return rows[0] || null;
}

module.exports = {
  getOrCreate,
  consume,
  getAccountUsage,
  linkCheckoutSession,
  setPlanByCustomerId,
};
