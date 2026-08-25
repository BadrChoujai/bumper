const path = require("path");
const { readJson, writeJson, hookScriptPath } = require("./util");

function install(cwd, { global = false } = {}) {
  const hooksPath = global
    ? path.join(require("os").homedir(), ".cursor", "hooks.json")
    : path.join(cwd, ".cursor", "hooks.json");

  const config = readJson(hooksPath);
  config.version = config.version || 1;
  config.hooks = config.hooks || {};

  const scriptPath = hookScriptPath("cursor");
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;

  const events = ["beforeShellExecution", "beforeMCPExecution"];
  let installedAny = false;

  for (const event of events) {
    config.hooks[event] = config.hooks[event] || [];
    const already = config.hooks[event].some((h) => h.command === command);
    if (!already) {
      config.hooks[event].push({ command, failClosed: false });
      installedAny = true;
    }
  }

  if (!installedAny) {
    return { installed: false, path: hooksPath, reason: "already installed" };
  }

  writeJson(hooksPath, config);
  return { installed: true, path: hooksPath };
}

module.exports = { install };
