const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { loadPolicy, evaluate, policyPathFor } = require("./policy");
const { explain } = require("./explain");
const { consumeAsk, getAccount, checkAuth, isQuotaEnabled, loadConfig } = require("./account");

const BUMPER_HOME = path.join(os.homedir(), ".bumper");
const AUDIT_LOG = path.join(BUMPER_HOME, "audit.jsonl");

function ensureHome() {
  if (!fs.existsSync(BUMPER_HOME)) fs.mkdirSync(BUMPER_HOME, { recursive: true });
}

function appendAudit(entry) {
  ensureHome();
  fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n");
}

function createDaemon() {
  const app = express();
  app.use(express.json());

  app.post("/check", async (req, res) => {
    const request = req.body || {};

    const auth = await checkAuth();
    if (!auth.authenticated) {
      const reason =
        "Bumper needs you logged in to protect this project — run `bumper login` in a terminal, then try again.";
      const entry = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        request,
        decision: "deny",
        reason,
        source: "auth",
      };
      appendAudit(entry);
      return res.json({ decision: "deny", reason, loginRequired: true });
    }

    const cwd = request.cwd || process.cwd();
    const policy = loadPolicy(policyPathFor(cwd));
    const result = evaluate(policy, request);
    const plainText = explain(request, result.rule);

    if (result.decision === "allow" || result.decision === "deny") {
      const entry = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        request,
        decision: result.decision,
        reason: plainText,
        source: "policy",
      };
      appendAudit(entry);
      return res.json({ decision: result.decision, reason: plainText });
    }

    // Narrow, deliberate scope: this only stands down the *unmatched
    // fallback* ask (result.rule is null -- nothing in the danger pack
    // matched, policy.default just happens to say "ask"). It must never
    // apply when an actual curated rule matched (force-push, npm publish,
    // secrets, DROP TABLE, chmod 777, curl|sh, ...) -- those are exactly
    // what Bumper exists to catch, and should always ask regardless of
    // mode. An earlier version of this check didn't distinguish the two
    // and silently waved through real danger-pack matches in auto mode --
    // that was a real bug, not the intended behavior.
    const STAND_DOWN_MODES = ["acceptEdits", "auto", "dontAsk", "bypassPermissions"];
    if (!result.rule && STAND_DOWN_MODES.includes(request.permissionMode)) {
      const reason = `${plainText} (auto-allowed — the agent is in ${request.permissionMode} mode, so Bumper didn't interrupt.)`;
      const entry = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        request,
        decision: "allow",
        reason,
        source: "policy-auto-mode",
      };
      appendAudit(entry);
      return res.json({ decision: "allow", reason });
    }

    // "ask" is the only decision that counts against the free-plan quota —
    // allow/deny above resolve silently and never touch the usage server.
    const quota = await consumeAsk();
    if (!quota.allowed) {
      const reason = `You've used all ${quota.limit || 15} free bumps this month. Upgrade to keep Bumper watching for risky actions.`;
      const entry = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        request,
        decision: "deny",
        reason,
        source: "quota",
      };
      appendAudit(entry);
      return res.json({ decision: "deny", reason, upgradeUrl: quota.upgradeUrl });
    }

    // Hook-based agents (everything except the MCP fallback) have their own
    // native permission UI — hand the decision straight back as "ask" with
    // the plain-English reason attached, and let the agent show its own
    // prompt instantly. This means Bumper never learns what the human
    // actually chose (that lives inside the agent now) — logged here as
    // "asked", not as the eventual outcome.
    if (request.agent !== "mcp") {
      const entry = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        request,
        decision: "ask",
        reason: plainText,
        source: "policy-native-ask",
      };
      appendAudit(entry);
      return res.json({ decision: "ask", reason: plainText });
    }

    // MCP fallback has no native prompt to defer to, and no local inbox to
    // put a human decision in front of anymore -- so a genuinely unclear
    // "ask" case can't safely become anything other than the policy's
    // fail-safe timeout decision (deny by default). Automatic allow/deny
    // rules above are unaffected; this only narrows what MCP mode does with
    // the truly ambiguous middle bucket.
    const reason = `${plainText} (Bumper's MCP fallback has no human inbox to ask, so it played it safe and said no. Install a native hook for this agent if one exists -- see \`bumper install\`.)`;
    const entry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      request,
      decision: policy.timeout_decision,
      reason,
      source: "mcp-no-inbox",
    };
    appendAudit(entry);
    return res.json({ decision: policy.timeout_decision, reason });
  });

  app.get("/log", (req, res) => {
    ensureHome();
    if (!fs.existsSync(AUDIT_LOG)) return res.json([]);
    const lines = fs.readFileSync(AUDIT_LOG, "utf8").trim().split("\n").filter(Boolean);
    const limit = Number(req.query.limit) || 200;
    const entries = lines.slice(-limit).map((l) => JSON.parse(l));
    res.json(entries.reverse());
  });

  app.get("/health", (req, res) => res.json({ ok: true }));

  // Lets `bumper update` release the daemon's file handles on its own
  // package directory before npm tries to rename it -- without this, an
  // update over a running daemon fails with EBUSY on Windows every time.
  app.post("/shutdown", (req, res) => {
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 150);
  });

  app.get("/account", async (req, res) => {
    const account = await getAccount({ fresh: req.query.fresh === "1" });
    res.json(account);
  });

  app.get("/auth", async (req, res) => {
    const auth = await checkAuth();
    res.json({ ...auth, quotaEnabled: isQuotaEnabled(), email: auth.email || loadConfig().email || null });
  });

  return app;
}

function start(port) {
  const app = createDaemon();
  const p = port || Number(process.env.BUMPER_PORT) || 4790;
  const server = app.listen(p, () => {
    console.log(`bumper is watching — http://localhost:${p}`);
  });
  return server;
}

module.exports = { createDaemon, start, BUMPER_HOME, AUDIT_LOG };
