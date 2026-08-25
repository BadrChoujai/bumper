const path = require("path");
const { readJson, writeJson, hookScriptPath } = require("./util");
const { checkVersionDrift } = require("./copilot-version");

// Verified against a real, live-fired session of the installed `@github/copilot`
// CLI (v1.0.80) — a real `rm -rf *` prompt was denied end to end, confirmed in
// the audit log. Schema, for reference:
//   - config file: .github/hooks/*.json (project) or ~/.copilot/hooks/*.json
//     (user), or inline under a top-level "hooks" key in config.json/settings.json
//   - entry needs "type": "command" plus one of bash / powershell / command
//   - stdin to the hook: { sessionId, timestamp, cwd, toolName, toolArgs }
//     (camelCase — different from Claude Code's snake_case tool_name/tool_input)
//   - stdout expected: { permissionDecision: "allow"|"deny"|"ask", permissionDecisionReason }
//   - a crash or non-zero exit denies the call; a timeout fails OPEN (allows)
// Copilot CLI is young and hasn't locked this schema down, so every install
// checks the installed version against the one actually tested (see
// ./copilot-version.js) and warns on drift instead of assuming it still works.
function install(cwd, { global = false } = {}) {
  const hooksDir = global
    ? path.join(require("os").homedir(), ".copilot", "hooks")
    : path.join(cwd, ".github", "hooks");
  const configPath = path.join(hooksDir, "bumper.json");

  const scriptPath = hookScriptPath("copilot");
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;

  const config = readJson(configPath);
  config.preToolUse = config.preToolUse || [];

  const versionCheck = checkVersionDrift();

  const already = config.preToolUse.some((h) => h.command === command);
  if (already) {
    return { installed: false, path: configPath, reason: "already installed", unverified: true, versionCheck };
  }

  config.preToolUse.push({ type: "command", command, timeoutSec: 30 });
  writeJson(configPath, config);
  return { installed: true, path: configPath, unverified: true, versionCheck };
}

module.exports = { install };
