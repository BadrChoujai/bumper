const DAEMON_URL = process.env.BUMPER_URL || "http://localhost:4790";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    if (process.stdin.isTTY) resolve("{}");
  });
}

async function checkWithDaemon(request) {
  try {
    // "ask" now resolves instantly (the calling agent's own native prompt
    // handles the wait, not this request) -- this timeout is just a safety
    // net against a genuinely hung daemon, not a real wait window anymore.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15 * 1000);
    const res = await fetch(`${DAEMON_URL}/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { decision: "allow", reason: "Bumper's daemon isn't responding, so this went through unchecked." };
    }
    return await res.json();
  } catch (err) {
    return {
      decision: "allow",
      reason: `Bumper isn't running right now, so this went through unchecked. Run \`bumper start\` to turn protection back on.`,
    };
  }
}

// Normalizes differing per-agent hook payload shapes into { tool, command, file, content }
function normalizeInput(raw) {
  const toolName = raw.tool_name || raw.toolName || raw.tool || raw.name || null;
  const toolInput = raw.tool_input || raw.toolInput || raw.toolArgs || raw.input || raw.arguments || raw;

  const command =
    raw.command || // Cursor beforeShellExecution puts command at top level
    (toolInput && (toolInput.command || toolInput.cmd)) ||
    null;

  const file = (toolInput && (toolInput.file_path || toolInput.path || toolInput.filePath)) || null;

  // Content of a file being written/edited, so secret-pattern rules can inspect it.
  const content =
    (toolInput &&
      (toolInput.content || toolInput.new_string || toolInput.new_str || toolInput.text)) ||
    null;

  return { tool: toolName, command, file, content };
}

module.exports = { readStdin, checkWithDaemon, normalizeInput, DAEMON_URL };
