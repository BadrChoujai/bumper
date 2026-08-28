# Bumper

A plain-language safety net for vibe coders.

Bumper pauses risky things your AI assistant (Claude Code, Cursor, Copilot CLI, or Codex CLI) is about to do, explains what's about to happen in a sentence you'd actually understand, and waits for you to say yes or no.

It works by wiring into each agent's own native permission system — the same mechanism that already asks "run this command?" — not a separate app watching from the outside.

## Install

```bash
npm install -g bumper-guard
bumper start
bumper login
```

`bumper start` runs the local daemon. Leave it running in the background. `bumper login` signs you in with just your email — a one-time code, no password — and is required before Bumper will protect anything. Risky actions get caught right inside the agent you're already using, via its own native permission prompt — no separate window to open.

Then wire it into whichever agent(s) you use:

```bash
bumper install claude-code
bumper install cursor
bumper install copilot
bumper install codex
```

Or install into all four at once with `bumper install all`. Add `--global` to any install command to protect every project on the machine instead of just the current one.

## What it actually checks

A default "danger pack" ships out of the box:

| Pattern | Decision |
|---|---|
| `rm -rf *` (or similarly broad deletes) | Blocked automatically |
| `git push --force` | Asks first |
| `curl ... \| sh` | Asks first |
| `npm publish` | Asks first |
| `DROP TABLE ...` / `DELETE FROM ... WHERE 1=1` | Asks first |
| A live secret key (Stripe, AWS, Supabase service-role) written into code | Asks first |

Copy `bumper.policy.example.yaml` to `bumper.policy.yaml` in your project (or `~/.bumper/policy.yaml` for every project) to add your own rules. See the file for the format — `match` on `command` (glob), `file` (glob), or `content_pattern` (regex against code being written), a `decision` of `allow`/`deny`/`ask`, and an `explain` string in plain English.

## How a decision gets made

- **Allow** / **Deny** — matches a rule, resolves instantly, nothing shown to you.
- **Ask** — the agent itself pauses and shows you Bumper's plain-English explanation right there, using its own native permission prompt (Claude Code, Cursor, Copilot CLI) — nothing to open, no separate window. The MCP fallback path (for agents without a native hook) instead opens the approval inbox at `http://localhost:4790` and waits up to 90 seconds before playing it safe and denying.

## Other commands

```bash
bumper status          # is the daemon running, are you logged in, how many decisions are pending
bumper update            # update to the latest version and restart the daemon
bumper login             # sign in with an email code — required before protection works
bumper logout            # sign out of this install
bumper log              # recent decisions, automatic and human
bumper autostart enable # run the daemon automatically on login
bumper mcp              # run as an MCP server (stdio) — fallback for agents without a native hook
```

## Agent support

| Agent | Status | Notes |
|---|---|---|
| Claude Code | Live-tested | `PreToolUse` hook, `.claude/settings.json` |
| Cursor | Live-tested | `beforeShellExecution` / `beforeMCPExecution`, `.cursor/hooks.json` |
| Copilot CLI | Live-tested | `preToolUse` hook; installed-version checked against the one actually tested, warns on drift |
| Codex CLI | Partial | No live hook exists in Codex CLI yet — falls back to a static `execpolicy` rule file plus Codex's own built-in approval prompt |

## What to be aware of

- **Protection depends on the daemon running.** If `bumper start` isn't running, hooks fail *open* — actions go through unchecked rather than getting stuck. `bumper autostart enable` fixes this by starting the daemon automatically on login (Startup folder on Windows, launchd on macOS, systemd on Linux — Windows is live-tested, macOS/Linux are implemented the same way but not yet run-tested).
- **Codex CLI has no live hook.** Real parity gap, not something Bumper can fix alone — depends on Codex CLI exposing one.
- **Copilot CLI's hook schema isn't locked down upstream.** Verified against a real install, but a future Copilot CLI update could change it. `bumper install copilot` checks the installed version and warns if it's drifted from the one last verified.
- **Only the unmatched-fallback ask stands down in an auto/bypass mode** (Claude Code's `acceptEdits`, `auto`, `dontAsk`, or `bypassPermissions`) — if nothing in the danger pack matched and the only reason it's asking is a generic policy default, Bumper won't contradict an agent that's already been told not to interrupt you. A matched danger-pack rule (force-push, `npm publish`, secrets, `DROP TABLE`, `chmod 777`, `curl|sh`, ...) **always asks, regardless of mode** — those are exactly what Bumper exists to catch, auto/bypass mode or not. Automatic *deny* rules (like `rm -rf *`) also always apply — that's a silent hard block, not a popup. Currently only wired up for Claude Code; Cursor and Copilot CLI don't send a mode signal yet, so their ask-decisions always pause as normal.

## Privacy

An account is required — sign in with your email and a one-time code, no password. Once signed in, the actual policy decisions still happen locally against your own rules: your code and commands never leave the machine. Only a session token travels to Bumper to confirm you're logged in — never your command, file, or code content.

## Pricing

Free during early access — unlimited, no plan to pick, just sign in. Paid tiers are coming once pricing is set from real usage rather than guesses; see [the roadmap](landing/roadmap.html) for what's next. The quota/billing machinery already exists server-side (see [server/README.md](server/README.md)) and is simply switched off for now.

## License

All rights reserved — see [LICENSE](LICENSE). Source is public for review; copying, redistribution, or reselling isn't.
