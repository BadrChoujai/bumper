const fs = require("fs");
const path = require("path");

// Codex CLI has no confirmed live external-callout hook (as of this research),
// only a static `execpolicy` .rules mechanism plus its own local approval prompt.
// Bumper can't show its plain-language explanations here or route decisions
// through the shared daemon — this is a real, honest parity gap.
//
// Best Bumper can do for Codex today: make sure Codex's own approval prompt
// stays on, so at least *something* checks before risky commands run.
function install(cwd, { global = false } = {}) {
  const configPath = global
    ? path.join(require("os").homedir(), ".codex", "config.toml")
    : path.join(cwd, ".codex", "config.toml");

  let contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";

  if (/^\s*approval_policy\s*=/m.test(contents)) {
    return {
      installed: false,
      path: configPath,
      reason: "approval_policy already set — left as-is",
      degraded: true,
    };
  }

  const addition =
    "\n# Added by bumper: Codex CLI has no live approval callout yet, so this\n" +
    "# keeps Codex's own prompt on for anything not explicitly allowed.\n" +
    'approval_policy = "on-request"\n';

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, contents + addition);

  return { installed: true, path: configPath, degraded: true };
}

module.exports = { install };
