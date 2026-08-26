const fs = require("fs");
const path = require("path");
const { DATA_FILE, FREE_ASKS_PER_MONTH } = require("./config");

// Flat-file JSON store, fine for the volume a single small server sees early
// on. Swap for real Postgres (Supabase/Neon) before this needs to scale past
// one process or you care about surviving a disk-level failure.

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");
}

function readAll() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Serializes writes so concurrent requests can't clobber each other's changes.
let writeQueue = Promise.resolve();
function writeAll(data) {
  writeQueue = writeQueue.then(
    () => fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2)),
    () => fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
  );
  return writeQueue;
}

function startOfNextMonth(from = new Date()) {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)).toISOString();
}

function freshFreeAccount(deviceId) {
  return {
    deviceId,
    email: null,
    plan: "free",
    asksUsed: 0,
    limit: FREE_ASKS_PER_MONTH,
    resetAt: startOfNextMonth(),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: new Date().toISOString(),
  };
}

// Lazily rolls a free account's counter over if its reset date has passed —
// no cron job needed, the check happens on read/write.
function applyReset(account) {
  if (account.plan !== "free") return account;
  if (new Date(account.resetAt).getTime() > Date.now()) return account;
  account.asksUsed = 0;
  account.resetAt = startOfNextMonth();
  return account;
}

async function getOrCreate(deviceId) {
  const all = readAll();
  let account = all[deviceId];
  if (!account) {
    account = freshFreeAccount(deviceId);
    all[deviceId] = account;
    await writeAll(all);
    return account;
  }
  const before = JSON.stringify(account);
  account = applyReset(account);
  if (JSON.stringify(account) !== before) {
    all[deviceId] = account;
    await writeAll(all);
  }
  return account;
}

function remaining(account) {
  if (account.plan !== "free") return Infinity;
  return Math.max(0, account.limit - account.asksUsed);
}

async function consume(deviceId) {
  const all = readAll();
  let account = all[deviceId] || freshFreeAccount(deviceId);
  account = applyReset(account);

  if (account.plan !== "free") {
    all[deviceId] = account;
    await writeAll(all);
    return { allowed: true, plan: account.plan, remaining: Infinity };
  }

  if (remaining(account) <= 0) {
    all[deviceId] = account;
    await writeAll(all);
    return { allowed: false, plan: account.plan, remaining: 0, limit: account.limit, resetAt: account.resetAt };
  }

  account.asksUsed += 1;
  all[deviceId] = account;
  await writeAll(all);
  return { allowed: true, plan: account.plan, remaining: remaining(account), limit: account.limit, resetAt: account.resetAt };
}

async function linkCheckoutSession(deviceId, { stripeCustomerId, email }) {
  const all = readAll();
  const account = all[deviceId] || freshFreeAccount(deviceId);
  account.stripeCustomerId = stripeCustomerId;
  if (email) account.email = email;
  all[deviceId] = account;
  await writeAll(all);
  return account;
}

async function setPlanByCustomerId(stripeCustomerId, { plan, stripeSubscriptionId }) {
  const all = readAll();
  const deviceId = Object.keys(all).find((id) => all[id].stripeCustomerId === stripeCustomerId);
  if (!deviceId) return null;
  all[deviceId].plan = plan;
  all[deviceId].stripeSubscriptionId = stripeSubscriptionId ?? all[deviceId].stripeSubscriptionId;
  await writeAll(all);
  return all[deviceId];
}

module.exports = {
  getOrCreate,
  consume,
  remaining,
  linkCheckoutSession,
  setPlanByCustomerId,
  freshFreeAccount,
};
