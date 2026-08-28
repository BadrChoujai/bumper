#!/usr/bin/env node
// Installed as beforeShellExecution / beforeMCPExecution in .cursor/hooks.json
const { readStdin, checkWithDaemon, normalizeInput } = require("./core");

(async () => {
  const raw = JSON.parse((await readStdin()) || "{}");
  const norm = normalizeInput(raw);

  const result = await checkWithDaemon({
    agent: "cursor",
    tool: norm.tool || "Bash",
    command: norm.command,
    file: norm.file,
    content: norm.content,
    cwd: raw.cwd || raw.workspace_root,
  });

  process.stdout.write(
    JSON.stringify({
      permission: result.decision === "deny" ? "deny" : result.decision === "ask" ? "ask" : "allow",
      user_message: result.reason,
      agent_message: result.reason,
    })
  );
  process.exit(0);
})();
