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
  app.use(express.static(path.join(__dirname, "..", "web")));

  const pending = new Map(); // id -> { request, resolve, createdAt, plainText }

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

    // "ask" -> hold for a human decision, with a timeout fallback
    const id = crypto.randomUUID();
    const timeoutMs = (policy.timeout_seconds || 90) * 1000;

    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      const reason = `Bumper didn't hear back from you in time, so it played it safe and said no. Ask your assistant to try again if you want to allow it.`;
      const entry = {
        id,
        ts: new Date().toISOString(),
        request,
        decision: policy.timeout_decision,
        reason,
        source: "timeout",
      };
      appendAudit(entry);
      res.json({ decision: policy.timeout_decision, reason });
    }, timeoutMs);

    pending.set(id, {
      request,
      plainText,
      createdAt: Date.now(),
      resolve: (decision, reason) => {
        clearTimeout(timer);
        const entry = {
          id,
          ts: new Date().toISOString(),
          request,
          decision,
          reason: reason || plainText,
          source: "human",
        };
        appendAudit(entry);
        res.json({ decision, reason: entry.reason });
      },
    });
  });

  app.get("/pending", (req, res) => {
    const list = Array.from(pending.entries()).map(([id, v]) => ({
      id,
      request: v.request,
      plainText: v.plainText,
      createdAt: v.createdAt,
    }));
    res.json(list);
  });

  app.post("/decide", (req, res) => {
    const { id, decision, reason } = req.body || {};
    const entry = pending.get(id);
    if (!entry) return res.status(404).json({ error: "not found or already resolved" });
    pending.delete(id);
    entry.resolve(decision, reason);
    res.json({ ok: true });
  });

  app.get("/log", (req, res) => {
    ensureHome();
    if (!fs.existsSync(AUDIT_LOG)) return res.json([]);
    const lines = fs.readFileSync(AUDIT_LOG, "utf8").trim().split("\n").filter(Boolean);
    const limit = Number(req.query.limit) || 200;
    const entries = lines.slice(-limit).map((l) => JSON.parse(l));
    res.json(entries.reverse());
  });

  app.get("/health", (req, res) => res.json({ ok: true, pending: pending.size }));

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
    console.log(`approve/deny inbox: http://localhost:${p}/index.html`);
  });
  return server;
}

module.exports = { createDaemon, start, BUMPER_HOME, AUDIT_LOG };
