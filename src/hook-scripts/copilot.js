#!/usr/bin/env node
// Installed as a preToolUse hook in .github/hooks/*.json or ~/.copilot/hooks/*.json
// Verified against the installed @github/copilot CLI (v1.0.80) + GitHub's hooks
// reference: stdin is { sessionId, timestamp, cwd, toolName, toolArgs } (camelCase),
// stdout expected is { permissionDecision, permissionDecisionReason }. Not yet
// fired live end-to-end (needs an authenticated session).
const { readStdin, checkWithDaemon, normalizeInput } = require("./core");

(async () => {
  const raw = JSON.parse((await readStdin()) || "{}");
  const norm = normalizeInput(raw);

  const result = await checkWithDaemon({
    agent: "copilot-cli",
    tool: norm.tool,
    command: norm.command,
    file: norm.file,
    content: norm.content,
    cwd: raw.cwd,
  });

  process.stdout.write(
    JSON.stringify({
      permissionDecision: result.decision === "deny" ? "deny" : result.decision === "ask" ? "ask" : "allow",
      permissionDecisionReason: result.reason,
    })
  );
  process.exit(0);
})();
