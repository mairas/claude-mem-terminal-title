# claude-mem-terminal-title

Keep each Claude Code terminal window's title tracking the topic you're actually
working on — even after `/clear`, and even when several windows sit on the same
repo.

> Status: scaffolding. The hooks are not implemented yet; work is tracked in the
> repository issues (Milestones 1 and 2).

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

Title format: `[project] task label`.

Claude Code animates the terminal title itself, which would overwrite the hook's
title. The installer sets `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` in `settings.json`
to hand title control to the hook. This disables Claude Code's own (animated)
title, including its auto-generated session title.

### Telling same-repo windows apart (Milestone 2, in progress)

Current behaviour picks the latest label for the window's project, so two windows
on the same repo show the same title. claude-mem keys generated rows by an internal
`memory_session_id` whose mapping back to a Claude Code session lags, so the project
is the only reliable key today.

Milestone 2 correlates by time: each window claims the project label generated after
its own most recent turn. That heuristic can still mis-assign if two same-repo
windows finish a turn within a few seconds of each other. The exact fix needs
claude-mem to stamp the originating session id onto each generated row — see
[`docs/upstream-issue.md`](docs/upstream-issue.md).

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
`./run uninstall`. Run `./run help` for all commands.

## License

MIT — see [LICENSE](LICENSE).
