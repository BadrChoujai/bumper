#!/usr/bin/env node
// Installed as a PreToolUse hook in .claude/settings.json
const { readStdin, checkWithDaemon, normalizeInput } = require("./core");

(async () => {
  const raw = JSON.parse((await readStdin()) || "{}");
  const norm = normalizeInput(raw);

  const result = await checkWithDaemon({
    agent: "claude-code",
    tool: norm.tool,
    command: norm.command,
    file: norm.file,
    content: norm.content,
    cwd: raw.cwd,
    session_id: raw.session_id,
  });

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: result.decision === "deny" ? "deny" : result.decision === "ask" ? "ask" : "allow",
        permissionDecisionReason: result.reason,
      },
    })
  );
  process.exit(0);
})();
