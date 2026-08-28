#!/usr/bin/env node
const { Command } = require("commander");
const path = require("path");
const readline = require("readline");

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

const program = new Command();
program.name("bumper").description("A plain-language safety net for vibe coders.").version("0.2.7");

program
  .command("start")
  .description("start the bumper daemon (protection + approval inbox)")
  .option("-p, --port <port>", "port to listen on", "4790")
  .action((opts) => {
    const { start } = require("../src/daemon");
    start(Number(opts.port));

    const { checkForUpdate, formatUpdateNotice } = require("../src/update-check");
    checkForUpdate().then((update) => {
      if (update) console.log(formatUpdateNotice(update));
    });
  });

program
  .command("update")
  .description("update bumper to the latest version and restart the daemon")
  .option("-p, --port <port>", "port the running daemon is on", "4790")
  .action(async (opts) => {
    console.log("stopping the daemon...");
    try {
      await fetch(`http://localhost:${opts.port}/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) });
    } catch {
      // not running, or already stopped -- nothing to release, carry on
    }
    await new Promise((r) => setTimeout(r, 500));

    console.log("updating (npm install -g bumper-guard)...");
    const { spawnSync, spawn } = require("child_process");
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npmCmd, ["install", "-g", "bumper-guard"], { stdio: "inherit" });
    if (result.status !== 0) {
      console.error("update failed — run `bumper start` yourself once you've sorted it out.");
      process.exitCode = 1;
      return;
    }

    console.log("restarting the daemon...");
    const child = spawn(process.execPath, [__filename, "start"], { detached: true, stdio: "ignore" });
    child.unref();
    console.log("updated and running.");
  });

program
  .command("install <agent>")
  .description("wire bumper into an agent's hooks (claude-code | cursor | copilot | codex | all)")
  .option("-g, --global", "install for all projects (user-level) instead of just this one", false)
  .action((agent, opts) => {
    const cwd = process.cwd();
    const installers = {
      "claude-code": require("../src/installers/claude-code"),
      cursor: require("../src/installers/cursor"),
      copilot: require("../src/installers/copilot"),
      codex: require("../src/installers/codex"),
    };

    const targets = agent === "all" ? Object.keys(installers) : [agent];

    for (const name of targets) {
      const installer = installers[name];
      if (!installer) {
        console.error(`unknown agent "${name}" — expected one of: ${Object.keys(installers).join(", ")}, all`);
        continue;
      }
      const result = installer.install(cwd, { global: !!opts.global });
      if (result.installed) {
        const note = result.degraded
          ? " (degraded — see note above)"
          : result.unverified
          ? " (upstream schema isn't locked down — version-checked automatically)"
          : "";
        console.log(`[${name}] installed -> ${result.path}${note}`);
      } else {
        console.log(`[${name}] skipped: ${result.reason} (${result.path})`);
      }
      if (result.versionCheck && result.versionCheck.drifted) {
        console.log(`[${name}] ⚠ ${result.versionCheck.warning}`);
      }
    }
  });

program
  .command("status")
  .description("check whether the bumper daemon is running")
  .option("-p, --port <port>", "port to check", "4790")
  .action(async (opts) => {
    try {
      const res = await fetch(`http://localhost:${opts.port}/health`);
      const body = await res.json();
      console.log(`bumper is running — ${body.pending} pending decision(s)`);
    } catch {
      console.log("bumper isn't running. Start it with: bumper start");
      return;
    }
    try {
      const res = await fetch(`http://localhost:${opts.port}/auth`);
      const auth = await res.json();
      if (auth.quotaEnabled) {
        console.log(auth.authenticated ? `logged in as ${auth.email}` : "not logged in — run `bumper login`");
      }
    } catch {
      // auth status is a nice-to-have, don't fail the whole command over it
    }
    try {
      const res = await fetch(`http://localhost:${opts.port}/account`);
      const account = await res.json();
      if (account.unlimited && account.plan === "free") {
        console.log("plan: free (unlimited — no quota server configured)");
      } else if (account.unlimited) {
        console.log(`plan: ${account.plan} (unlimited)`);
      } else if (account.plan === "unknown") {
        console.log("plan: couldn't reach the usage server, protection still runs unlimited for now");
      } else {
        console.log(`plan: ${account.plan} — ${account.remaining ?? "?"} bump(s) left this month`);
      }
    } catch {
      // account status is a nice-to-have, don't fail the whole command over it
    }
    const { checkForUpdate, formatUpdateNotice } = require("../src/update-check");
    const update = await checkForUpdate();
    if (update) console.log(formatUpdateNotice(update));
  });

program
  .command("login [email]")
  .description("log in (or sign up) with an email code — required before bumper will protect anything")
  .action(async (email) => {
    const account = require("../src/account");
    if (!account.isQuotaEnabled()) {
      console.log("no quota/auth server is configured for this install — nothing to log into.");
      return;
    }
    if (!email) email = await prompt("Email: ");
    try {
      await account.requestLoginCode(email);
    } catch (err) {
      console.error(`couldn't send a code: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`code sent to ${email} — check your inbox.`);
    const code = await prompt("Code: ");
    try {
      const result = await account.verifyLoginCode(email, code);
      console.log(`logged in as ${result.email}.`);
    } catch (err) {
      console.error(`login failed: ${err.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("logout")
  .description("log out of this install")
  .action(() => {
    const account = require("../src/account");
    account.logout();
    console.log("logged out.");
  });

program
  .command("upgrade")
  .description("get your upgrade link (removes the free monthly bump limit)")
  .option("-p, --port <port>", "port to check", "4790")
  .action(async (opts) => {
    try {
      const res = await fetch(`http://localhost:${opts.port}/account?fresh=1`);
      const account = await res.json();
      if (account.unlimited && account.plan === "free") {
        console.log("you're already unlimited — no quota server is configured for this install.");
      } else if (account.unlimited) {
        console.log(`you're already on the ${account.plan} plan — nothing to upgrade.`);
      } else if (account.upgradeUrl) {
        console.log(`open this link to upgrade: ${account.upgradeUrl}`);
      } else {
        console.log("couldn't get an upgrade link right now — try again in a moment.");
      }
    } catch {
      console.log("bumper isn't running. Start it with: bumper start");
    }
  });

program
  .command("log")
  .description("show recent decisions")
  .option("-p, --port <port>", "port to check", "4790")
  .option("-n, --limit <n>", "how many to show", "20")
  .action(async (opts) => {
    try {
      const res = await fetch(`http://localhost:${opts.port}/log?limit=${opts.limit}`);
      const entries = await res.json();
      for (const e of entries) {
        console.log(`[${e.ts}] ${e.decision.toUpperCase()} (${e.source}) — ${e.reason}`);
      }
    } catch {
      console.log("bumper isn't running. Start it with: bumper start");
    }
  });

program
  .command("mcp")
  .description("run bumper as an MCP server (stdio) — fallback for agents without a native hook")
  .action(() => {
    require("../src/mcp-server");
  });

program
  .command("autostart <action>")
  .description("run the daemon automatically on login (action: enable | disable | status)")
  .action((action) => {
    const autostart = require("../src/installers/autostart");
    try {
      if (action === "enable") {
        const result = autostart.enable();
        console.log(`autostart enabled via ${result.mechanism} (${result.ref})`);
        console.log("bumper will now start automatically the next time you log in.");
      } else if (action === "disable") {
        const result = autostart.disable();
        console.log(result.removed ? "autostart disabled." : `nothing to disable: ${result.reason}`);
      } else if (action === "status") {
        const result = autostart.status();
        console.log(result.enabled ? `autostart is ON — ${result.mechanism} (${result.ref})` : "autostart is OFF.");
      } else {
        console.error(`unknown action "${action}" — expected enable, disable, or status`);
      }
    } catch (err) {
      console.error(`autostart ${action} failed: ${err.message}`);
      console.error("your platform's service manager (Task Scheduler / launchd / systemd) may need elevated permissions, or isn't available here.");
    }
  });

program.parse(process.argv);
