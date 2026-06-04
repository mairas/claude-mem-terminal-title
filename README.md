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

Default title format: `{emoji} [{project}] {label}`, where `{label}` is the
current task. When the window has no task label yet (a fresh window, or a project
with no claude-mem history), `{label}` falls back to `Claude Code` so the title
always at least names the project. The format is configurable — see
[Configuration](#configuration).

The leading emoji is unique-ish per window and stays fixed for that window's whole
life, so you can recognise a window at a glance instead of reading the text. It's
derived from the session id, so two windows usually differ but aren't guaranteed
to (true uniqueness would need shared state). Drop the `{emoji}` token from your
format to turn it off.

Claude Code animates the terminal title itself, which would overwrite the hook's
title. The installer sets `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` in `settings.json`
to hand title control to the hook. This disables Claude Code's own (animated)
title, including its auto-generated session title.

### Telling same-repo windows apart

claude-mem doesn't stamp the originating session onto a summary, and its
`memory_session_id` mapping back to a Claude Code session lags, so the project alone
can't distinguish two windows on the same repo. This tool correlates by time using
claude-mem's `user_prompts` table (a reliable per-window prompt timeline): a summary
belongs to whichever of the project's windows prompted most recently before it was
generated. No extra hook or state file — the prompt timeline already lives in the
database.

This is a heuristic with a real failure envelope: claude-mem generates a summary
asynchronously *after* a turn, so if a second same-project window merely sends a
prompt while the first window's turn is still being summarised, the summary can be
attributed to the wrong window — the first window's title goes stale and the second
shows work it didn't do. The prompt timeline alone can't disambiguate two windows
with overlapping open turns. The exact fix needs claude-mem to stamp the originating
session id onto each generated row, which shipped upstream in
[claude-mem #2770](https://github.com/thedotmack/claude-mem/pull/2770). Once a
released claude-mem carries it, this tool can correlate on that id directly instead
of guessing by time — tracked in
[#5](https://github.com/mairas/claude-mem-terminal-title/issues/5). Until then, the
titles are reliable for windows whose turns don't overlap and best-effort when they
do.

## Configuration

Optional. Without a config file the default format applies. To customise, create:

```
~/.config/claude-mem-terminal-title/config.json
```

(honours `$XDG_CONFIG_HOME`; override the whole path with `CMTT_CONFIG`)

```json
{ "format": "{emoji} [{project}] {label}" }
```

| Token | Meaning |
|-------|---------|
| `{emoji}` | The window's fixed emoji (empty until the session is registered) |
| `{project}` | Project name (git root or cwd basename) |
| `{label}` | Current task label from claude-mem, or `Claude Code` as fallback |

Unknown `{tokens}` are left as-is. A missing or malformed config file falls back to
the default format silently — the hook never disrupts the session. Some format
ideas: `{emoji} {project}: {label}`, `{project} — {label}` (no emoji),
`{emoji} {label}`.

## Requirements

- Claude Code ≥ 2.1.141 (for hook `terminalSequence`)
- claude-mem installed and generating memory
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
