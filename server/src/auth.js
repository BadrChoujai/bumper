const crypto = require("crypto");
const db = require("./db");
const email = require("./email");

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_CACHE_MS = 60_000;

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

const REQUEST_COOLDOWN_MS = 30_000;
let lastRequestAt = new Map(); // email -> timestamp

async function requestCode(emailAddress) {
  const last = lastRequestAt.get(emailAddress);
  if (last && Date.now() - last < REQUEST_COOLDOWN_MS) {
    return { ok: false, reason: "Wait a bit before requesting another code." };
  }
  lastRequestAt.set(emailAddress, Date.now());

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await db.query(
    `insert into verification_codes (email, code, expires_at) values ($1, $2, $3)`,
    [emailAddress, code, expiresAt]
  );
  await email.sendVerificationCode(emailAddress, code);
  return { ok: true };
}

// Three cases, in order:
//  1. This email has logged in before — use that account (its own original
//     device_id is irrelevant; one account can be logged into from many
//     devices/browsers, each getting its own session row).
//  2. This device already has an anonymous free-tier account (created the
//     moment the daemon first ran, before any login) — attach the email to
//     it, so free-tier usage already spent this month carries over instead
//     of quietly resetting.
//  3. Neither exists — brand new account.
async function resolveAccountForLogin(emailAddress, deviceIdHint) {
  const byEmail = await db.query(`select * from accounts where email = $1`, [emailAddress]);
  if (byEmail.rows[0]) return byEmail.rows[0];

  if (deviceIdHint) {
    const byDevice = await db.query(`select * from accounts where device_id = $1`, [deviceIdHint]);
    if (byDevice.rows[0]) {
      const updated = await db.query(
        `update accounts set email = $2, updated_at = now() where id = $1 returning *`,
        [byDevice.rows[0].id, emailAddress]
      );
      return updated.rows[0];
    }
  }

  const deviceId = deviceIdHint || `web-${crypto.randomUUID()}`;
  const created = await db.query(
    `insert into accounts (device_id, email) values ($1, $2) returning *`,
    [deviceId, emailAddress]
  );
  return created.rows[0];
}

// deviceIdHint: the CLI's local device id, used to satisfy accounts.device_id
// (not null/unique) when this email has never logged in before. Web logins
// have no device id, so a synthetic one is generated instead.
async function verifyCode(emailAddress, code, { deviceIdHint, kind } = {}) {
  const { rows } = await db.query(
    `select id from verification_codes
     where email = $1 and code = $2 and used_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [emailAddress, code]
  );
  if (!rows[0]) return { ok: false, reason: "That code is invalid or has expired." };

  await db.query(`update verification_codes set used_at = now() where id = $1`, [rows[0].id]);

  const account = await resolveAccountForLogin(emailAddress, deviceIdHint);

  const token = crypto.randomBytes(32).toString("hex");
  await db.query(
    `insert into sessions (account_id, token, kind) values ($1, $2, $3)`,
    [account.id, token, kind === "web" ? "web" : "cli"]
  );

  return { ok: true, token, account };
}

let sessionCache = new Map(); // token -> { account, cachedAt }

async function checkSession(token) {
  if (!token) return null;
  const cached = sessionCache.get(token);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_MS) return cached.account;

  const { rows } = await db.query(
    `select a.* from sessions s
     join accounts a on a.id = s.account_id
     where s.token = $1`,
    [token]
  );
  if (!rows[0]) {
    sessionCache.delete(token);
    return null;
  }
  db.query(`update sessions set last_seen_at = now() where token = $1`, [token]).catch(() => {});
  sessionCache.set(token, { account: rows[0], cachedAt: Date.now() });
  return rows[0];
}

module.exports = { requestCode, verifyCode, checkSession };
