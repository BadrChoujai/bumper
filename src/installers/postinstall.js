// Runs automatically after `npm install -g bumper-guard` (see package.json's
// "postinstall" script). Collapses what used to be three separate manual
// steps — start the daemon, wire every agent by hand, enable autostart —
// into "install, then just log in." Never fatal: a detection miss or a
// permission error here shouldn't break someone's npm install.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const AGENT_MARKERS = {
  "claude-code": path.join(os.homedir(), ".claude"),
  cursor: path.join(os.homedir(), ".cursor"),
  copilot: path.join(os.homedir(), ".copilot"),
};

function detectAgents() {
  return Object.entries(AGENT_MARKERS)
    .filter(([, markerPath]) => fs.existsSync(markerPath))
    .map(([name]) => name);
}

function wireAgents(agents) {
  for (const name of agents) {
    try {
      const installer = require(`./${name}`);
      const result = installer.install(process.cwd(), { global: true });
      console.log(result.installed ? `[bumper] wired into ${name}` : `[bumper] ${name}: ${result.reason}`);
    } catch (err) {
      console.log(`[bumper] couldn't wire into ${name}: ${err.message}`);
    }
  }
}

function startDaemonDetached() {
  try {
    const binPath = path.join(__dirname, "..", "..", "bin", "bumper.js");
    const child = spawn(process.execPath, [binPath, "start"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (err) {
    console.log(`[bumper] couldn't start the daemon automatically: ${err.message}`);
  }
}

function enableAutostart() {
  try {
    require("./autostart").enable();
  } catch (err) {
    console.log(`[bumper] couldn't enable autostart: ${err.message} — run 'bumper autostart enable' yourself if you want it.`);
  }
}

function main() {
  const agents = detectAgents();
  if (agents.length) wireAgents(agents);
  startDaemonDetached();
  enableAutostart();

  console.log("");
  console.log("bumper is installed and running in the background.");
  console.log("Run `bumper login` to sign in — required before it protects anything.");
}

main();
