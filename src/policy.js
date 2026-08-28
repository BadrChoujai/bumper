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

    // ---- git: irreversible history/working-tree changes ----
    {
      id: "git-reset-hard",
      match: { command: "*git reset*--hard*" },
      decision: "ask",
      explain: "This throws away uncommitted changes, and any commits it resets past — there's no undo once it runs.",
    },
    {
      id: "git-clean-force",
      match: { command: "*git clean*-f*" },
      decision: "ask",
      explain: "This permanently deletes files that aren't tracked by git — anything not committed yet is gone for good.",
    },
    {
      id: "git-branch-force-delete",
      match: { command: "*git branch*-D*" },
      decision: "ask",
      explain: "This force-deletes a branch, including any commits on it that aren't merged anywhere else.",
    },
    {
      id: "git-discard-changes",
      match: { command: "git checkout -- *" },
      decision: "ask",
      explain: "This discards your uncommitted changes to that file — there's no undo.",
    },
    {
      id: "git-restore",
      match: { command: "git restore *" },
      decision: "ask",
      explain: "This can discard uncommitted changes in your working tree — there's no undo for the ones it reverts.",
    },
    {
      id: "git-push-delete-remote",
      match: { command: "*git push*--delete*" },
      decision: "ask",
      explain: "This deletes a branch or tag from the shared remote — if others are using it, it's gone for them too.",
    },
    {
      id: "git-history-rewrite",
      match: { command: "git filter-branch*" },
      decision: "ask",
      explain: "This rewrites the project's entire history. Anyone else who's cloned this repo will have a hard time syncing up again.",
    },
    {
      id: "git-filter-repo",
      match: { command: "git filter-repo*" },
      decision: "ask",
      explain: "This rewrites the project's entire history. Anyone else who's cloned this repo will have a hard time syncing up again.",
    },

    // ---- databases: beyond the single DROP TABLE / DELETE-all rules above ----
    {
      id: "sql-drop-database",
      match: { command: "*DROP DATABASE*" },
      decision: "ask",
      explain: "This will permanently delete an entire database — every table, every row, gone.",
    },
    {
      id: "sql-truncate",
      match: { command: "*TRUNCATE TABLE*" },
      decision: "ask",
      explain: "This empties a table completely. The table stays, but every row in it is permanently gone.",
    },
    {
      id: "mongo-drop-database",
      match: { command: "*dropDatabase(*" },
      decision: "ask",
      explain: "This permanently deletes an entire MongoDB database.",
    },
    {
      id: "redis-flush",
      match: { command: "*FLUSHALL*" },
      decision: "ask",
      explain: "This permanently wipes every key in Redis — all of it, across every database.",
    },
    {
      id: "redis-flushdb",
      match: { command: "*FLUSHDB*" },
      decision: "ask",
      explain: "This permanently wipes every key in the current Redis database.",
    },

    // ---- cloud infra: real, billed, often-shared resources ----
    {
      id: "terraform-destroy",
      match: { command: "terraform destroy*" },
      decision: "ask",
      explain: "This tears down real infrastructure — servers, databases, anything Terraform manages here.",
    },
    {
      id: "terraform-auto-approve",
      match: { command: "*terraform apply*-auto-approve*" },
      decision: "ask",
      explain: "This applies infrastructure changes without a review step — whatever the plan says, it just happens.",
    },
    {
      id: "aws-s3-recursive-delete",
      match: { command: "*aws s3 rm*--recursive*" },
      decision: "ask",
      explain: "This permanently deletes every file under that S3 path.",
    },
    {
      id: "aws-s3-bucket-remove",
      match: { command: "*aws s3 rb*" },
      decision: "ask",
      explain: "This deletes an S3 bucket, and everything in it.",
    },
    {
      id: "kubectl-delete-namespace",
      match: { command: "*kubectl delete namespace*" },
      decision: "ask",
      explain: "This deletes a Kubernetes namespace and everything running inside it.",
    },
    {
      id: "kubectl-delete-all",
      match: { command: "*kubectl delete*--all*" },
      decision: "ask",
      explain: "This deletes every matching resource at once, not just one.",
    },
    {
      id: "docker-system-prune",
      match: { command: "*docker system prune*" },
      decision: "ask",
      explain: "This permanently removes unused Docker images, containers, and networks — anything not currently running.",
    },
    {
      id: "docker-volume-prune",
      match: { command: "*docker volume prune*" },
      decision: "ask",
      explain: "This permanently deletes Docker volumes — if any hold real data (like a database), that data is gone.",
    },

    // ---- filesystem: beyond the broad rm -rf * block above ----
    {
      id: "rm-recursive",
      match: { command: "rm -r *" },
      decision: "ask",
      explain: "This deletes a folder and everything in it — there's no undo once it runs.",
    },
    {
      id: "windows-remove-item-recurse",
      match: { command: "*Remove-Item*-Recurse*" },
      decision: "ask",
      explain: "This deletes a folder and everything in it — there's no undo once it runs.",
    },
    {
      id: "windows-rd-recursive",
      match: { command: "rd /s*" },
      decision: "ask",
      explain: "This deletes a folder and everything in it — there's no undo once it runs.",
    },
    {
      id: "windows-rmdir-recursive",
      match: { command: "rmdir /s*" },
      decision: "ask",
      explain: "This deletes a folder and everything in it — there's no undo once it runs.",
    },
    {
      id: "windows-del-force",
      match: { command: "del /f*" },
      decision: "ask",
      explain: "This force-deletes files, skipping the usual confirmation — there's no undo once it runs.",
    },
    {
      id: "find-delete",
      match: { command: "find*-delete*" },
      decision: "ask",
      explain: "This deletes every file that matches the search — there's no undo once it runs.",
    },
    {
      id: "shred-file",
      match: { command: "shred *" },
      decision: "ask",
      explain: "This securely erases a file so it can't be recovered, even with data-recovery tools — by design, there's no undo.",
    },

    // ---- packages/releases: public, and hard or impossible to fully take back ----
    {
      id: "npm-unpublish",
      match: { command: "*npm unpublish*" },
      decision: "ask",
      explain: "This removes a published package version from npm. Depending on how long it's been up, this can be permanent and can even block republishing the same name for a while.",
    },
    {
      id: "yarn-unpublish",
      match: { command: "*yarn unpublish*" },
      decision: "ask",
      explain: "This removes a published package version from npm. Depending on how long it's been up, this can be permanent and can even block republishing the same name for a while.",
    },
    {
      id: "gh-release-delete",
      match: { command: "gh release delete*" },
      decision: "ask",
      explain: "This deletes a published GitHub release.",
    },

    // ---- system-level: essentially never something a coding agent should do
    // unsupervised, so these are blocked outright rather than asked about ----
    {
      id: "raw-disk-write",
      match: { command: "*dd *of=/dev/*" },
      decision: "deny",
      explain: "This writes raw data directly to a disk device — it can silently destroy an entire drive. Bumper blocked it automatically — if this was intentional, run it yourself in a terminal.",
    },
    {
      id: "format-drive-unix",
      match: { command: "mkfs*" },
      decision: "deny",
      explain: "This formats a drive, erasing everything on it. Bumper blocked it automatically — if this was intentional, run it yourself in a terminal.",
    },
    {
      id: "format-drive-windows",
      match: { command: "*Format-Volume*" },
      decision: "deny",
      explain: "This formats a drive, erasing everything on it. Bumper blocked it automatically — if this was intentional, run it yourself in a terminal.",
    },
    {
      id: "fork-bomb",
      match: { command: "*:(){ :|:& };:*" },
      decision: "deny",
      explain: "This is a fork bomb — it multiplies itself until the machine runs out of resources and locks up. Bumper blocked it automatically.",
    },

    // ---- secrets: beyond Stripe/AWS/Supabase above ----
    {
      id: "github-token",
      match: { content_pattern: "gh[pousr]_[A-Za-z0-9]{20,}" },
      decision: "ask",
      explain: "This looks like a real GitHub access token being written into {file}. If it ends up in a public repo, someone could use it as you.",
    },
    {
      id: "google-api-key",
      match: { content_pattern: "AIza[0-9A-Za-z\\-_]{35}" },
      decision: "ask",
      explain: "This looks like a real Google API key being written into {file}. If it ships to the browser or a public repo, someone could run up charges on your account.",
    },
    {
      id: "slack-token",
      match: { content_pattern: "xox[baprs]-[0-9A-Za-z-]+" },
      decision: "ask",
      explain: "This looks like a real Slack token being written into {file}. If it leaks, someone could read or post in your workspace as you.",
    },
    {
      id: "private-key-block",
      match: { content_pattern: "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----" },
      decision: "ask",
      explain: "This looks like a real private key being written into {file}. Anyone who gets it can impersonate whatever it authenticates.",
    },
    {
      id: "env-file-write",
      match: { file: "*.env" },
      decision: "ask",
      explain: "Your AI assistant is writing to {file} — if it holds real secrets and this file ever gets committed, they're exposed.",
    },
    {
      id: "env-local-write",
      match: { file: "*.env.local" },
      decision: "ask",
      explain: "Your AI assistant is writing to {file} — if it holds real secrets and this file ever gets committed, they're exposed.",
    },
    {
      id: "env-production-write",
      match: { file: "*.env.production" },
      decision: "ask",
      explain: "Your AI assistant is writing to {file} — if it holds real secrets and this file ever gets committed, they're exposed.",
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
  const customRules = Array.isArray(parsed.rules) ? parsed.rules : [];
  return {
    default: parsed.default || DEFAULT_POLICY.default,
    timeout_seconds: parsed.timeout_seconds || DEFAULT_POLICY.timeout_seconds,
    timeout_decision: parsed.timeout_decision || DEFAULT_POLICY.timeout_decision,
    // Custom rules are checked first (so a rule can deliberately override a
    // built-in one by reusing its id, or by just matching first), but the
    // built-in danger pack always stays active underneath -- a project's
    // own rules should be able to add to Bumper's protection, not silently
    // replace all 50+ of them the moment the file has one rule in it.
    rules: [...customRules, ...DEFAULT_POLICY.rules],
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
