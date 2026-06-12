# claude-mem-terminal-title

Keep each Claude Code terminal window's title tracking the topic you're actually
working on — even after `/clear`, and even when several windows sit on the same
repo.

## The problem

Claude Code sets the terminal title once, early in a session. When you pivot to a
new topic — after `/clear`, or by asking for a quick cleanup before the real work
starts — the title goes stale. With half a dozen windows open, finding the right
one becomes guesswork.

## The approach

[claude-mem](https://github.com/thedotmack/claude-mem) already watches each
session and generates a rolling, Haiku-summarised task label (the `request` field
in its `session_summaries` table), updated roughly every turn. This tool reuses
that label as the window title — no extra model calls.

A `Stop` hook reads the current task label for the window's project from
claude-mem's SQLite database and emits an `OSC 0` terminal sequence (via the hook's
top-level `terminalSequence` output field, Claude Code ≥ 2.1.141) to set the title.

Default title format: `[{project}] {label}`, where `{label}` is the current task.
When the window has no task label yet, `{label}` falls back to the session's
opening prompt, and to `Claude Code` when claude-mem hasn't registered the session
at all, so the title always at least names the project. The format is configurable — see
[Configuration](#configuration). Want a leading emoji to spot the window at a
glance? Put one in the template yourself, e.g. `🦊 [{project}] {label}`.

Claude Code animates the terminal title itself, which would overwrite the hook's
title. The installer sets `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` in `settings.json`
to hand title control to the hook. This disables Claude Code's own (animated)
title, including its auto-generated session title.

### Telling same-repo windows apart

claude-mem ([#2770](https://github.com/thedotmack/claude-mem/pull/2770), released)
stamps each summary with the `memory_session_id` of the generation run that wrote
it, and `sdk_sessions` maps a window's `content_session_id` to its *current*
`memory_session_id`. That mapping rotates between generation runs without updating
older rows, so only a window's most recent summaries resolve through it; older
summaries are orphaned — their memory id is on no session row.

The resolver attributes summaries in this order, latest match winning:

1. A summary stamped with this window's current memory id belongs to this window.
2. A summary stamped with *another* window's current memory id is never shown here.
3. An orphaned summary is correlated by time using claude-mem's `user_prompts`
   table, but only via a matching prompt ordinal: it belongs to the window whose
   prompt with the summary's `prompt_number` most recently preceded it. An orphaned
   summary without a `prompt_number` is shown nowhere — the window falls back to
   its opening prompt. The anchor keeps a window that merely prompts during another
   window's generation lag from stealing the summary.

The orphan path is still a heuristic: two same-project windows sitting at the same
prompt ordinal with overlapping turns can mis-attribute. That envelope is far
narrower than pure time correlation, and rules 1–2 make recent summaries exact.

## Configuration

Optional. Without a config file the default format applies. To customise, create
`~/.config/claude-mem-terminal-title.yaml` (honours `$XDG_CONFIG_HOME`; override the
whole path with `CMTT_CONFIG`):

```yaml
# Title template. Tokens: {project} {label}. Add a literal emoji if you like.
format: "🦊 [{project}] {label}"
```

| Token | Meaning |
|-------|---------|
| `{project}` | Project name (git root or cwd basename) |
| `{label}` | Current task label from claude-mem, falling back to the session's opening prompt, then `Claude Code` |

Unknown `{tokens}` are left as-is. Any other characters — including a leading emoji —
are kept verbatim, so put one in the template if you want it. A missing, empty, comment-only,
or otherwise unusable config falls back to the default format silently — the hook
never disrupts the session. Some format ideas: `🦊 {project}: {label}`, `{project} — {label}`.

## Requirements

- Claude Code ≥ 2.1.141 (for hook `terminalSequence`)
- claude-mem at a release carrying
  [#2770](https://github.com/thedotmack/claude-mem/pull/2770) (`memory_session_id`
  stamping; verified against v13.5.6). On older schemas the hook leaves the title
  unchanged — `./run doctor` diagnoses this.
- [bun](https://bun.sh) (used by claude-mem already; provides in-process SQLite)
- A terminal that honours `OSC 0` window-title sequences

## Install

```sh
./run install     # adds the Stop hook + CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 to settings.json
```

Restart Claude Code (or start a new session) so the env var takes effect. Remove with
`./run uninstall`. If titles stop updating, `./run doctor` checks the live claude-mem
DB and reports a schema mismatch. Run `./run help` for all commands.

## License

MIT — see [LICENSE](LICENSE).
