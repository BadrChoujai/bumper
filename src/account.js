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

// Quota enforcement is opt-in and off by default: as long as no server URL is
// configured, every "ask" event is unlimited — identical to today's behavior.
// Set BUMPER_SERVER_URL (env) or { "serverUrl": "..." } in ~/.bumper/config.json
// once the usage-check server (see /server) is deployed to turn it on.
function serverUrl() {
  return process.env.BUMPER_SERVER_URL || loadConfig().serverUrl || null;
}

function isQuotaEnabled() {
  return !!serverUrl();
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
};
