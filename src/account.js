const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const BUMPER_HOME = path.join(os.homedir(), ".bumper");
const CONFIG_PATH = path.join(BUMPER_HOME, "config.json");

function ensureHome() {
  if (!fs.existsSync(BUMPER_HOME)) fs.mkdirSync(BUMPER_HOME, { recursive: true });
}

function loadConfig() {
  ensureHome();
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  ensureHome();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Stable per-machine id, generated once on first use — lets the usage server
// track a free plan before any signup/email is involved.
function ensureDeviceId() {
  const config = loadConfig();
  if (config.deviceId) return config.deviceId;
  config.deviceId = crypto.randomUUID();
  saveConfig(config);
  return config.deviceId;
}

// Ships pointed at the real usage/auth server by default — this is what
// makes login required out of the box. Overridable (env var or
// { "serverUrl": "..." } in ~/.bumper/config.json) for local development
// against a test server, or set to "" to fully disable and run dormant/local-only.
const DEFAULT_SERVER_URL = "https://bumper-usage-server.fly.dev";

function serverUrl() {
  const configured = process.env.BUMPER_SERVER_URL ?? loadConfig().serverUrl;
  if (configured === "") return null;
  return configured || DEFAULT_SERVER_URL;
}

function isQuotaEnabled() {
  return !!serverUrl();
}

async function requestLoginCode(email) {
  const res = await fetch(`${serverUrl()}/auth/request-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "couldn't request a code");
}

async function verifyLoginCode(email, code) {
  const deviceId = ensureDeviceId();
  const res = await fetch(`${serverUrl()}/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code, deviceId, kind: "cli" }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "verification failed");
  const config = loadConfig();
  config.token = body.token;
  config.email = body.email;
  saveConfig(config);
  authCache = { authenticated: true, cachedAt: Date.now() };
  return body;
}

function logout() {
  const config = loadConfig();
  delete config.token;
  delete config.email;
  saveConfig(config);
  authCache = null;
}

// Bumper only protects logged-in users once a quota server is configured —
// same dormant-unless-configured escape hatch as everything else here, so
// running from source with no server set stays fully open for development.
// A stored token is trusted optimistically (no round trip needed just to
// keep working) and only distrusted on an explicit 401 — a confirmed
// revoke/expiry — never on a generic network hiccup, matching the
// fail-open philosophy the daemon already uses everywhere else.
let authCache = null;
const AUTH_CACHE_MS = 5 * 60_000;

async function checkAuth() {
  if (!isQuotaEnabled()) return { authenticated: true };

  const config = loadConfig();
  if (!config.token) return { authenticated: false, reason: "not_logged_in" };

  if (authCache && Date.now() - authCache.cachedAt < AUTH_CACHE_MS) {
    return authCache;
  }

  try {
    const res = await fetch(`${serverUrl()}/auth/session`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401) {
      authCache = { authenticated: false, reason: "invalid_session" };
      return authCache;
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    authCache = { authenticated: true, email: body.email, plan: body.plan, cachedAt: Date.now() };
    return authCache;
  } catch {
    // Network/server hiccup — trust the locally stored token rather than
    // locking out an already-logged-in user over a transient failure.
    return { authenticated: true, degraded: true };
  }
}

// Called once per "ask" decision, before the human is shown anything.
// Returns { allowed: true, remaining, plan } or { allowed: false, remaining: 0, plan, upgradeUrl }.
// Network/server failures fail OPEN (allowed: true) — same "protection needs the
// daemon, but never hard-breaks your workflow" philosophy as the daemon itself.
async function consumeAsk() {
  if (!isQuotaEnabled()) {
    return { allowed: true, unlimited: true };
  }
  const deviceId = ensureDeviceId();
  try {
    const res = await fetch(`${serverUrl()}/usage/consume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { allowed: true, unlimited: true, degraded: true };
    return await res.json();
  } catch {
    return { allowed: true, unlimited: true, degraded: true };
  }
}

// Cheap, cached read for status displays — doesn't consume a bump.
let accountCache = null;
let accountCacheAt = 0;
const ACCOUNT_CACHE_MS = 60_000;

async function getAccount({ fresh } = {}) {
  if (!isQuotaEnabled()) return { plan: "free", unlimited: true };
  if (!fresh && accountCache && Date.now() - accountCacheAt < ACCOUNT_CACHE_MS) {
    return accountCache;
  }
  const deviceId = ensureDeviceId();
  try {
    const res = await fetch(`${serverUrl()}/usage/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    accountCache = await res.json();
    accountCacheAt = Date.now();
    return accountCache;
  } catch (err) {
    return { plan: "unknown", error: err.message };
  }
}

module.exports = {
  BUMPER_HOME,
  CONFIG_PATH,
  loadConfig,
  saveConfig,
  ensureDeviceId,
  isQuotaEnabled,
  consumeAsk,
  getAccount,
  requestLoginCode,
  verifyLoginCode,
  logout,
  checkAuth,
};
