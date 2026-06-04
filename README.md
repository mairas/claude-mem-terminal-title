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

Two hooks do the work:

- `UserPromptSubmit` records this window's session id and the time of its latest
  prompt to a small state file.
- `Stop` reads the current task label for the window's project from claude-mem's
  SQLite database and emits an `OSC 2` terminal sequence (via the hook
  `terminalSequence` field, Claude Code ≥ 2.1.141) to set the title.

Title format: `[project] task label`.

### Telling same-repo windows apart

claude-mem keys generated rows by an internal `memory_session_id`, and the mapping
back to a Claude Code session lags, so "latest label for this project" alone can't
distinguish two windows on the same repo. This tool correlates by time: each window
claims the project label generated after its own most recent turn.

That heuristic can mis-assign if two same-repo windows finish a turn within a few
seconds of each other. The exact fix needs claude-mem to stamp the originating
session id onto each generated row — see [`docs/upstream-issue.md`](docs/upstream-issue.md).

## Requirements

- Claude Code ≥ 2.1.141 (for hook `terminalSequence`)
- claude-mem installed and generating memory
- [bun](https://bun.sh) (used by claude-mem already; provides in-process SQLite)
- A terminal that honours `OSC 0/2` window-title sequences

## Install

Coming with Milestone 1. Run `./run help` to see available commands.

## License

MIT — see [LICENSE](LICENSE).
