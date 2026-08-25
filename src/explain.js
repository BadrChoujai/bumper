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
// (no specific rule matched, but the default decision is "ask").
const FALLBACK_PATTERNS = [
  {
    test: (r) => /rm\s+-rf/i.test(r.command || ""),
    explain: (r) =>
      `This will permanently delete files (\`${r.command}\`) with no way to undo it.`,
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
    return `Your AI assistant wants to run this: \`${request.command}\`. It's not on the list of things marked safe, so it's checking with you first.`;
  }
  if (request.file) {
    return `Your AI assistant wants to change \`${request.file}\`. That's not on the list of things marked safe, so it's checking with you first.`;
  }
  return `Your AI assistant wants to use ${request.tool || "a tool"} in a way that's not on the list of things marked safe, so it's checking with you first.`;
}

// matchedRule: the policy rule that matched (may carry its own `explain` template), or null
function explain(request, matchedRule) {
  if (matchedRule && matchedRule.explain) {
    return fillTemplate(matchedRule.explain, request);
  }
  return genericExplain(request);
}

module.exports = { explain, fillTemplate, genericExplain };
