const path = require("path");
const { readJson, writeJson, hookScriptPath } = require("./util");

function install(cwd, { global = false } = {}) {
  const settingsPath = global
    ? path.join(require("os").homedir(), ".claude", "settings.json")
    : path.join(cwd, ".claude", "settings.json");

  const settings = readJson(settingsPath);
  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  const scriptPath = hookScriptPath("claude-code");
  const alreadyInstalled = settings.hooks.PreToolUse.some((entry) =>
    (entry.hooks || []).some((h) => h.args && h.args.includes(scriptPath))
  );

  if (alreadyInstalled) {
    return { installed: false, path: settingsPath, reason: "already installed" };
  }

  settings.hooks.PreToolUse.push({
    matcher: "*",
    hooks: [
      {
        type: "command",
        command: process.execPath,
        args: [scriptPath],
        timeout: 120,
      },
    ],
  });

  writeJson(settingsPath, settings);
  return { installed: true, path: settingsPath };
}

module.exports = { install };
