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

// A `category` on a rule buys it a hand-curated explanation for free, instead
// of every rule (built-in or a user's own custom one) needing its own
// full sentence. Add a category here only when several rules genuinely share
// the same shape of explanation -- these are exact-text extractions of what
// used to be duplicated per-rule, not new wording.
const CATEGORY_TEMPLATES = {
  "recursive-delete": () => "This deletes a folder and everything in it — there's no undo once it runs.",
  "force-push": () =>
    "This will overwrite the project's shared history. If you've shared this project with anyone else, their work could be lost.",
  unpublish: () =>
    "This removes a published package version from npm. Depending on how long it's been up, this can be permanent and can even block republishing the same name for a while.",
  "env-write": (request) =>
    `Your AI assistant is writing to ${request.file || "this file"} — if it holds real secrets and this file ever gets committed, they're exposed.`,
  // Rules using this category add their own short `secret_name` (and
  // optional `secret_detail`) plus `consequence` instead of a full sentence.
  "secret-write": (request, rule) => {
    const file = request.file || "this file";
    const detail = rule.secret_detail ? ` — ${rule.secret_detail}` : "";
    const consequence = rule.consequence || "If it leaks, it could be used against you.";
    return `This looks like a ${rule.secret_name || "secret"} being written into ${file}${detail}. ${consequence}`;
  },
};

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

// matchedRule: the policy rule that matched (may carry its own `explain`
// template, or a `category` that resolves to one), or null if nothing matched.
function explain(request, matchedRule) {
  if (!matchedRule) return genericExplain(request);
  if (matchedRule.explain) return fillTemplate(matchedRule.explain, request);
  if (matchedRule.category && CATEGORY_TEMPLATES[matchedRule.category]) {
    return CATEGORY_TEMPLATES[matchedRule.category](request, matchedRule);
  }
  // A rule matched (built-in or from someone's own bumper.policy.yaml) but
  // nobody wrote an explanation and it's not a known category -- state the
  // fact plainly rather than guessing what the command actually does.
  const who = matchedRule.id ? `your rule "${matchedRule.id}"` : "a policy rule";
  return `This matches ${who} and is set to ${matchedRule.decision}.`;
}

module.exports = { explain, fillTemplate, genericExplain, CATEGORY_TEMPLATES };
