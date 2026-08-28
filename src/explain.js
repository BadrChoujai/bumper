// Turns a matched policy rule (or an unmatched request) into one plain-English
// sentence a non-technical vibe coder can understand without help.
// Hand-curated templates only — no free-form LLM paraphrase of the raw command,
// because a wrong or confusing translation destroys trust immediately.

function fillTemplate(template, request) {
  return template
    .replace(/\{command\}/g, request.command || "this command")
    .replace(/\{file\}/g, request.file || "this file")
    .replace(/\{tool\}/g, request.tool || "a tool");
}

// Fallback heuristics for requests that fall through to the default policy
// with no specific rule matched -- e.g. a custom policy.yaml that changed
// `default` without redeclaring the built-in danger-pack rules.
const FALLBACK_PATTERNS = [
  {
    test: (r) => /rm\s+-rf/i.test(r.command || ""),
    explain: () => `This will permanently delete files with no way to undo it.`,
  },
  {
    test: (r) => /git\s+push\s+(--force|-f)\b/i.test(r.command || ""),
    explain: () =>
      `This will overwrite the project's shared history. If you've shared this project with anyone else, their work could be lost.`,
  },
  {
    test: (r) => /(npm|yarn|pnpm)\s+publish/i.test(r.command || ""),
    explain: () =>
      `This will publish a new public version of this package that anyone can install.`,
  },
  {
    test: (r) => /curl.*\|\s*(sh|bash)\b/i.test(r.command || ""),
    explain: () =>
      `This downloads a script from the internet and runs it immediately — there's no way to see what it does first.`,
  },
  {
    test: (r) => /chmod\s+777/i.test(r.command || ""),
    explain: () =>
      `This makes files or folders open to anyone with access to this machine — usually not what you want.`,
  },
  {
    test: (r) => /drop\s+table|delete\s+from.*where\s+1\s*=\s*1/i.test(r.command || ""),
    explain: () => `This will permanently delete data from a database.`,
  },
];

function genericExplain(request) {
  for (const p of FALLBACK_PATTERNS) {
    if (p.test(request)) return p.explain(request);
  }
  if (request.command) {
    return `This command isn't covered by one of Bumper's automatic rules.`;
  }
  if (request.file) {
    return `Changing this file isn't covered by one of Bumper's automatic rules.`;
  }
  return `Using ${request.tool || "this tool"} this way isn't covered by one of Bumper's automatic rules.`;
}

// matchedRule: the policy rule that matched (may carry its own `explain` template), or null
function explain(request, matchedRule) {
  if (matchedRule && matchedRule.explain) {
    return fillTemplate(matchedRule.explain, request);
  }
  return genericExplain(request);
}

module.exports = { explain, fillTemplate, genericExplain };
