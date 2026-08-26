# Bumper

A plain-language safety net for vibe coders.

Bumper pauses risky things your AI assistant (Claude Code, Cursor, Copilot CLI, or Codex CLI) is about to do, explains what's about to happen in a sentence you'd actually understand, and waits for you to say yes or no.

It works by wiring into each agent's own native permission system — the same mechanism that already asks "run this command?" — not a separate app watching from the outside.

## Install

```bash
npm install -g bumper-guard
bumper start
```

`bumper start` runs the local daemon and the approval inbox at `http://localhost:4790`. Leave it running in the background.

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
- **Ask** — pauses the agent and opens the approval inbox. If you don't respond within the configured timeout (90 seconds by default), it plays it safe and denies.

## Other commands

```bash
bumper status          # is the daemon running, how many decisions are pending, your plan
bumper log              # recent decisions, automatic and human
bumper upgrade           # get your upgrade link once you've hit the free monthly limit
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

## Privacy

Everything runs locally by default — no account, no cloud, nothing about your code or your commands leaves the machine. The only exception: once a paid tier is enabled (`BUMPER_SERVER_URL` configured), each *ask* decision sends a random device ID and a plan-check request to the usage server — never your command, file, or code content. Auto-resolved allow/deny decisions never touch the network either way.

## Pricing

Free — 15 "ask" decisions per month (the ones Bumper actually pauses you for; silent allow/deny never counts) with no account needed. Past that, upgrade to keep protection on — run `bumper upgrade` for your link. See [the roadmap](landing/roadmap.html) for what's next.

The free limit is enforced by a small usage-check server, deployed separately — see [server/README.md](server/README.md). Until that server is deployed and configured, Bumper runs fully unlimited and fully local, same as before.

## License

All rights reserved — see [LICENSE](LICENSE). Source is public for review; copying, redistribution, or reselling isn't.
