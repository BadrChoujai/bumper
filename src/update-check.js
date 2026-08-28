const { loadConfig, saveConfig } = require("./account");
const CURRENT_VERSION = require("../package.json").version;

const REGISTRY_URL = "https://registry.npmjs.org/bumper-guard/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseVersion(v) {
  return String(v).split(".").map((n) => parseInt(n, 10) || 0);
}

// Returns true if `a` is newer than `b`.
function isNewer(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// Checks npm at most once every 24h (cached in ~/.bumper/config.json) so
// this never spams the registry on every command. Fails silently offline —
// an update nudge is a nice-to-have, never worth breaking a command over.
async function checkForUpdate() {
  const config = loadConfig();
  const cached = config.updateCheck;
  const now = Date.now();

  if (cached && now - cached.checkedAt < CHECK_INTERVAL_MS) {
    return cached.latest && isNewer(cached.latest, CURRENT_VERSION)
      ? { current: CURRENT_VERSION, latest: cached.latest }
      : null;
  }

  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    const latest = body.version;
    config.updateCheck = { checkedAt: now, latest };
    saveConfig(config);
    return isNewer(latest, CURRENT_VERSION) ? { current: CURRENT_VERSION, latest } : null;
  } catch {
    return null;
  }
}

function formatUpdateNotice({ current, latest }) {
  return `A newer version of bumper is available: ${current} -> ${latest}. Run \`npm install -g bumper-guard\` to update.`;
}

module.exports = { checkForUpdate, formatUpdateNotice, isNewer, CURRENT_VERSION };
