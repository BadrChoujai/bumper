const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// "Planned: version pinning" — Copilot CLI's hook schema isn't officially
// locked down yet (confirmed by inspecting its own source this session).
// Rather than silently break when it changes, warn when the installed
// version drifts from the one Bumper's copilot.js was actually verified
// against, so a mismatch is visible instead of a mystery.
const TESTED_VERSION = "1.0.80";

// Reads the installed package's own package.json rather than shelling out to
// `copilot --version` — that command was found to crash under some sandboxed
// environments (an unrelated native-module load failure), so avoid invoking
// the CLI at all just to answer "what version is this."
function getInstalledVersion() {
  try {
    // execSync (runs through the platform shell), not execFileSync — on
    // Windows, npm is a .cmd file, and execFile can't spawn those directly
    // without shell resolution (fails with EINVAL). The command here is a
    // fixed literal with no user input, so shell interpolation isn't a risk.
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    const pkgPath = path.join(globalRoot, "@github", "copilot", "package.json");
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || null;
  } catch {
    return null;
  }
}

function checkVersionDrift() {
  const installed = getInstalledVersion();
  if (!installed) {
    return { checked: false, reason: "@github/copilot not found via `npm root -g` — is it installed globally?" };
  }
  if (installed === TESTED_VERSION) {
    return { checked: true, drifted: false, installed, tested: TESTED_VERSION };
  }
  return {
    checked: true,
    drifted: true,
    installed,
    tested: TESTED_VERSION,
    warning: `Copilot CLI v${installed} detected, but Bumper's hook integration was last verified against v${TESTED_VERSION}. It'll probably still work — Copilot CLI hasn't broken this before — but if hooks stop firing, this version drift is the first thing to check.`,
  };
}

module.exports = { TESTED_VERSION, getInstalledVersion, checkVersionDrift };
