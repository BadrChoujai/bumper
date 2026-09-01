# Bumper

> **Beta** — Early access. Please report issues.

A plain-language safety net for vibe coders.

Bumper pauses risky things your AI assistant (Claude Code, Cursor, or Copilot CLI) is about to do, explains what's about to happen in a sentence you'd actually understand, and waits for you to say yes or no.

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
```

Or install into all of them at once with `bumper install all` (this also wires in Codex CLI — see [Agent support](#agent-support), it has no live hook yet so it falls back to a static rule file). Add `--global` to any install command to protect every project on the machine instead of just the current one.

## What it actually checks

A default "danger pack" ships out of the box — 50+ rules, covering every category of irreversible action a coding agent realistically runs into, not just a handful of examples. Full source: [src/policy.js](src/policy.js).

| Category | Examples | Decision |
|---|---|---|
| Truly no-undo filesystem wipes | `rm -rf *`, raw disk writes (`dd ... of=/dev/...`), formatting a drive (`mkfs`, `Format-Volume`), a fork bomb | **Blocked automatically** |
| Other irreversible deletes | `rm -r`, `git clean -f`, `find -delete`, `shred`, PowerShell `Remove-Item -Recurse`, Windows `rd`/`del /f` | Asks first |
| Git history/working-tree loss | `git push --force`, `git reset --hard`, `git branch -D`, `git checkout --`/`git restore`, `git push --delete`, `git filter-branch` | Asks first |
| Databases | `DROP TABLE`/`DROP DATABASE`, `TRUNCATE`, `DELETE ... WHERE 1=1`, MongoDB `dropDatabase()`, Redis `FLUSHALL`/`FLUSHDB` | Asks first |
| Cloud infrastructure | `terraform destroy`/`-auto-approve`, `aws s3 rm --recursive`/`rb`, `kubectl delete namespace`/`--all`, `docker system prune`/`volume prune` | Asks first |
| Blind script execution | `curl ... \| sh` | Asks first |
| Public releases, hard to fully undo | `npm publish`, `npm unpublish`, `gh release delete` | Asks first |
| Live secrets landing in code | Stripe, AWS, GitHub, Google, Slack keys, private key blocks, or a write to `.env`/`.env.local`/`.env.production` | Asks first |

To add your own rules on top of the built-in pack (without replacing it), copy `bumper.policy.example.yaml` to `bumper.policy.yaml` in your project (or `~/.bumper/policy.yaml` for every project). See the file for the format — `match` on `command` (glob), `file` (glob), or `content_pattern` (regex against code being written), a `decision` of `allow`/`deny`/`ask`, and either an `explain` string in plain English or a built-in `category` (`recursive-delete`, `force-push`, `unpublish`, `env-write`, `secret-write`) that supplies the wording for you. Rules with neither still get a plain, honest fallback message instead of silence.

## How a decision gets made

- **Allow** / **Deny** — matches a rule, resolves instantly, nothing shown to you.
- **Ask** — the agent itself pauses and shows you Bumper's plain-English explanation right there, using its own native permission prompt (Claude Code, Cursor, Copilot CLI) — nothing to open, no separate window. The MCP fallback path (for agents without a native hook) has no human inbox to defer to, so it plays it safe and denies instead — automatic allow/deny rules still apply normally either way.

## Other commands

```bash
bumper status          # is the daemon running, are you logged in
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

## Important note

**The daemon must be running for protection to work.** If `bumper start` isn't running, hooks fail *open* — actions go through unchecked rather than getting stuck. Use `bumper autostart enable` to start the daemon automatically on login (Startup folder on Windows, launchd on macOS, systemd on Linux).

## Privacy

An account is required — sign in with your email and a one-time code, no password. Once signed in, the actual policy decisions still happen locally against your own rules: your code and commands never leave the machine. Only a session token travels to Bumper to confirm you're logged in — never your command, file, or code content.

## Pricing

Free during early access — unlimited, no plan to pick, just sign in. Paid tiers are coming once pricing is set from real usage rather than guesses; see [the roadmap](landing/roadmap.html) for what's next. The quota/billing machinery already exists server-side (see [server/README.md](server/README.md)) and is simply switched off for now.

## License

All rights reserved — see [LICENSE](LICENSE). Source is public for review; copying, redistribution, or reselling isn't.
