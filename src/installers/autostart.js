const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// "Planned: auto-start" — run the daemon as a background service that starts
// on login, so protection stops depending on remembering `bumper start`.
// One mechanism per OS, each using that OS's own service manager rather than
// a custom background-process hack, so it survives reboots/crashes properly.

const BIN_PATH = path.join(__dirname, "..", "..", "bin", "bumper.js");
const LAUNCH_AGENT_LABEL = "com.bumper.autostart";
const LAUNCH_AGENT_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
const SYSTEMD_UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const SYSTEMD_UNIT_PATH = path.join(SYSTEMD_UNIT_DIR, "bumper.service");

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// ---------------------------------------------------------------- Windows --
// Uses the per-user Startup folder rather than Task Scheduler: it needs zero
// elevated permissions (Task Scheduler can refuse even per-user logon tasks
// under some policies — confirmed on this machine), and it's the same
// mechanism most consumer Windows apps already use to launch at login.
const WIN_STARTUP_DIR = () =>
  path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const WIN_LAUNCHER_PATH = () => path.join(WIN_STARTUP_DIR(), "BumperAutostart.vbs");

function windowsLauncherContents() {
  const command = `"${process.execPath}" "${BIN_PATH}" start`;
  // WScript.Shell.Run(..., 0, False) = launch hidden, don't wait — the daemon
  // keeps running in the background with no visible console window.
  return `Set objShell = CreateObject("WScript.Shell")\r\nobjShell.Run "${command.replace(/"/g, '""')}", 0, False\r\n`;
}
function enableWindows() {
  fs.writeFileSync(WIN_LAUNCHER_PATH(), windowsLauncherContents());
  return { platform: "win32", mechanism: "Startup folder", ref: WIN_LAUNCHER_PATH() };
}
function disableWindows() {
  if (!fs.existsSync(WIN_LAUNCHER_PATH())) return { removed: false, reason: "no autostart entry found" };
  fs.unlinkSync(WIN_LAUNCHER_PATH());
  return { removed: true };
}
function statusWindows() {
  if (!fs.existsSync(WIN_LAUNCHER_PATH())) return { enabled: false };
  return { enabled: true, mechanism: "Startup folder", ref: WIN_LAUNCHER_PATH() };
}

// ------------------------------------------------------------------ macOS --
function plistContents() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${BIN_PATH}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), ".bumper", "autostart.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), ".bumper", "autostart.log")}</string>
</dict>
</plist>
`;
}
function enableMac() {
  fs.mkdirSync(path.dirname(LAUNCH_AGENT_PATH), { recursive: true });
  fs.mkdirSync(path.join(os.homedir(), ".bumper"), { recursive: true });
  fs.writeFileSync(LAUNCH_AGENT_PATH, plistContents());
  run("launchctl", ["load", "-w", LAUNCH_AGENT_PATH]);
  return { platform: "darwin", mechanism: "launchd LaunchAgent", ref: LAUNCH_AGENT_PATH };
}
function disableMac() {
  if (!fs.existsSync(LAUNCH_AGENT_PATH)) return { removed: false, reason: "no autostart LaunchAgent found" };
  try {
    run("launchctl", ["unload", "-w", LAUNCH_AGENT_PATH]);
  } catch {
    /* already unloaded — still remove the file below */
  }
  fs.unlinkSync(LAUNCH_AGENT_PATH);
  return { removed: true };
}
function statusMac() {
  if (!fs.existsSync(LAUNCH_AGENT_PATH)) return { enabled: false };
  try {
    const list = run("launchctl", ["list"]);
    return { enabled: list.includes(LAUNCH_AGENT_LABEL), mechanism: "launchd LaunchAgent", ref: LAUNCH_AGENT_PATH };
  } catch {
    return { enabled: true, mechanism: "launchd LaunchAgent", ref: LAUNCH_AGENT_PATH, note: "plist present, launchctl status unknown" };
  }
}

// ------------------------------------------------------------------ Linux --
function systemdUnitContents() {
  return `[Unit]
Description=Bumper — plain-language safety net daemon

[Service]
ExecStart=${process.execPath} ${BIN_PATH} start
Restart=on-failure

[Install]
WantedBy=default.target
`;
}
function enableLinux() {
  fs.mkdirSync(SYSTEMD_UNIT_DIR, { recursive: true });
  fs.writeFileSync(SYSTEMD_UNIT_PATH, systemdUnitContents());
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", "--now", "bumper.service"]);
  return { platform: "linux", mechanism: "systemd user service", ref: SYSTEMD_UNIT_PATH };
}
function disableLinux() {
  if (!fs.existsSync(SYSTEMD_UNIT_PATH)) return { removed: false, reason: "no autostart service found" };
  try {
    run("systemctl", ["--user", "disable", "--now", "bumper.service"]);
  } catch {
    /* unit may already be inactive — still remove the file below */
  }
  fs.unlinkSync(SYSTEMD_UNIT_PATH);
  run("systemctl", ["--user", "daemon-reload"]);
  return { removed: true };
}
function statusLinux() {
  if (!fs.existsSync(SYSTEMD_UNIT_PATH)) return { enabled: false };
  try {
    const state = run("systemctl", ["--user", "is-enabled", "bumper.service"]).trim();
    return { enabled: state === "enabled", mechanism: "systemd user service", ref: SYSTEMD_UNIT_PATH };
  } catch {
    return { enabled: false };
  }
}

// -------------------------------------------------------------- dispatch --
function enable() {
  if (process.platform === "win32") return enableWindows();
  if (process.platform === "darwin") return enableMac();
  if (process.platform === "linux") return enableLinux();
  throw new Error(`autostart isn't supported on platform "${process.platform}" yet`);
}
function disable() {
  if (process.platform === "win32") return disableWindows();
  if (process.platform === "darwin") return disableMac();
  if (process.platform === "linux") return disableLinux();
  throw new Error(`autostart isn't supported on platform "${process.platform}" yet`);
}
function status() {
  if (process.platform === "win32") return statusWindows();
  if (process.platform === "darwin") return statusMac();
  if (process.platform === "linux") return statusLinux();
  return { enabled: false, note: `unsupported platform "${process.platform}"` };
}

module.exports = { enable, disable, status };
