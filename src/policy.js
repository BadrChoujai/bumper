const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// Default "vibe-coder danger pack" — curated from real incident patterns
// (Escape.tech scanned 5,600 deployed vibe-coded apps in early 2026 and found
// 400+ exposed secrets and 2,000+ critical vulnerabilities; these rules target
// the common causes: hardcoded secrets, destructive ops, force pushes, blind
// script execution, and publishing/DB-wiping commands).
const DEFAULT_POLICY = {
  // Only the curated rules below ever ask or deny -- everything else (touch,
  // ls, cat, mkdir, a normal git commit, ...) runs instantly. The whole
  // pitch is "safe things run instantly, genuinely risky things pause" --
  // defaulting to "ask" for anything unmatched would mean asking about
  // literally everything, which is the opposite of that promise.
  default: "allow",
  timeout_seconds: 90,
  timeout_decision: "deny",
  rules: [
    {
      id: "destructive-delete-broad",
      match: { command: "rm -rf *" },
      decision: "deny",
      explain:
        "This would permanently delete files with no way to undo it. Bumper blocked it automatically — if this was intentional, run it yourself in a terminal.",
    },
    {
      id: "force-push",
      match: { command: "git push --force*" },
      decision: "ask",
      explain:
        "This will overwrite the project's shared history. If you've shared this project with anyone else, their work could be lost.",
    },
    {
      id: "force-push-short",
      match: { command: "git push -f*" },
      decision: "ask",
      explain:
        "This will overwrite the project's shared history. If you've shared this project with anyone else, their work could be lost.",
    },
    {
      id: "publish-package",
      match: { command: "npm publish*" },
      decision: "ask",
      explain: "This will publish a new public version of this package that anyone can install.",
    },
    {
      id: "curl-pipe-shell",
      match: { command: "*curl*|*sh" },
      decision: "ask",
      explain:
        "This downloads a script from the internet and runs it immediately — there's no way to see what it does first.",
    },
    {
      id: "chmod-777",
      match: { command: "*chmod 777*" },
      decision: "ask",
      explain: "This makes files open to anyone with access to this machine — usually not what you want.",
    },
    {
      id: "sql-drop-table",
      match: { command: "*DROP TABLE*" },
      decision: "ask",
      explain: "This will permanently delete a table (and everything in it) from a database.",
    },
    {
      id: "sql-delete-all",
      match: { command: "*DELETE FROM*WHERE 1=1*" },
      decision: "ask",
      explain: "This will permanently delete data from a database, and the condition matches every row.",
    },
    {
      id: "stripe-live-key",
      match: { content_pattern: "sk_live_[A-Za-z0-9]{10,}" },
      decision: "ask",
      explain:
        "This looks like a real (live) Stripe secret key being written into {file}. If this file is ever visible in the browser or pushed to a public repo, someone could use it to charge your account.",
    },
    {
      id: "aws-access-key",
      match: { content_pattern: "AKIA[0-9A-Z]{16}" },
      decision: "ask",
      explain:
        "This looks like a real AWS access key being written into {file}. If this ships to the browser or a public repo, someone could run up charges on your AWS account.",
    },
    {
      id: "supabase-service-role",
      match: { content_pattern: "service_role" },
      decision: "ask",
      explain:
        "This looks like a Supabase service-role key being written into {file} — it bypasses all your security rules. If it ends up somewhere the browser can see, anyone could read or delete your entire database.",
    },
  ],
};

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withStars = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${withStars}$`, "is");
}

function loadPolicy(policyPath) {
  if (!fs.existsSync(policyPath)) {
    return DEFAULT_POLICY;
  }
  const raw = fs.readFileSync(policyPath, "utf8");
  const parsed = yaml.load(raw) || {};
  return {
    default: parsed.default || DEFAULT_POLICY.default,
    timeout_seconds: parsed.timeout_seconds || DEFAULT_POLICY.timeout_seconds,
    timeout_decision: parsed.timeout_decision || DEFAULT_POLICY.timeout_decision,
    rules: Array.isArray(parsed.rules) ? parsed.rules : DEFAULT_POLICY.rules,
  };
}

// request: { tool, command, file, content, agent }
// Returns { decision, reason, rule } where `rule` is the matched rule (or null for the default).
function evaluate(policy, request) {
  for (const rule of policy.rules) {
    const m = rule.match || {};
    let matched = true;

    if (m.tool && request.tool && m.tool !== "*") {
      if (m.tool.toLowerCase() !== String(request.tool).toLowerCase()) matched = false;
    }
    if (matched && m.command) {
      if (!request.command || !globToRegExp(m.command).test(request.command)) matched = false;
    }
    if (matched && m.file) {
      if (!request.file || !globToRegExp(m.file).test(request.file)) matched = false;
    }
    if (matched && m.content_pattern) {
      if (!request.content || !new RegExp(m.content_pattern).test(request.content)) matched = false;
    }
    if (matched && m.agent) {
      if (!request.agent || m.agent.toLowerCase() !== String(request.agent).toLowerCase()) matched = false;
    }

    if (matched) {
      return { decision: rule.decision, reason: rule.reason || null, rule };
    }
  }
  return { decision: policy.default, reason: null, rule: null };
}

function policyPathFor(cwd) {
  const local = path.join(cwd, "bumper.policy.yaml");
  if (fs.existsSync(local)) return local;
  const home = path.join(require("os").homedir(), ".bumper", "policy.yaml");
  return home;
}

module.exports = { loadPolicy, evaluate, DEFAULT_POLICY, policyPathFor, globToRegExp };
