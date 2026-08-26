#!/usr/bin/env node
const { Command } = require("commander");
const path = require("path");

const program = new Command();
program.name("bumper").description("A plain-language safety net for vibe coders.").version("0.1.0");

program
  .command("start")
  .description("start the bumper daemon (protection + approval inbox)")
  .option("-p, --port <port>", "port to listen on", "4790")
  .action((opts) => {
    const { start } = require("../src/daemon");
    start(Number(opts.port));
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
      const res = await fetch(`http://localhost:${opts.port}/account`);
      const account = await res.json();
      if (account.unlimited) {
        console.log("plan: free (unlimited — no quota server configured)");
      } else if (account.plan === "unknown") {
        console.log("plan: couldn't reach the usage server, protection still runs unlimited for now");
      } else {
        console.log(`plan: ${account.plan} — ${account.remaining ?? "?"} bump(s) left this month`);
      }
    } catch {
      // account status is a nice-to-have, don't fail the whole command over it
    }
  });

program
  .command("upgrade")
  .description("get your upgrade link (removes the free monthly bump limit)")
  .option("-p, --port <port>", "port to check", "4790")
  .action(async (opts) => {
    try {
      const res = await fetch(`http://localhost:${opts.port}/account?fresh=1`);
      const account = await res.json();
      if (account.unlimited) {
        console.log("you're already unlimited — no quota server is configured for this install.");
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
