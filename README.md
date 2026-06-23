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

A `Stop` hook names each window after the current topic of its session. The topic
comes from a short LLM summary of your recent prompts, generated on the fly — the
tool has no external dependency on claude-mem (or anything else that has to be
running).

The hook sets the title in two stages so it's both instant and accurate:

1. **Synchronously**, it emits a placeholder via Claude Code's `terminalSequence`
   output — the topic it generated last (cached), or, before there is one, your
   latest typed prompt. No waiting.
2. **Asynchronously**, when the conversation has moved on since the cached topic,
   it spawns a detached process that summarizes your recent prompts into a 3–6
   word topic and writes the title straight to the window's terminal — out of
   band, a few seconds later. The result is cached so the next turn shows it
   instantly.

Because the slow LLM call is detached, it never blocks the session, and there is
no per-turn latency.

Default title format: `[{project}] {label}`, where `{project}` is the git-root
basename of the working directory and `{label}` is the generated topic. The format
is configurable — see [Configuration](#configuration). Want a leading emoji to spot
the window at a glance? Put one in the template, e.g. `🦊 [{project}] {label}`.

Claude Code animates the terminal title itself, which would fight the hook. The
installer sets `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` in `settings.json` to hand
title control to the hook.

### Authentication — no API key

The summarizer runs through the [Claude Agent
SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) in **isolation
mode** (`settingSources: []`): it reuses your existing Claude Code subscription
login, so there is no API key to manage and no separate per-token billing. Each
topic is one short Claude Haiku call. Isolation mode also means the spawned
`claude` loads none of your user settings — so it can't recurse into this hook,
and it leaves no trace in other tools.

### Telling same-repo windows apart

The detached updater writes the title directly to the window's terminal device. It
finds that device by walking its own process tree up to the `claude` process that
owns the window's pty — so with several windows open on the same repo, each
update lands on the right one. The generated topic is cached per session id.

## Configuration

Optional. Without a config file the defaults apply. To customise, create
`~/.config/claude-mem-terminal-title.yaml` (honours `$XDG_CONFIG_HOME`; override the
whole path with `CMTT_CONFIG`):

```yaml
# Title template. Tokens: {project} {label}. Add a literal emoji if you like.
format: "🦊 [{project}] {label}"
# Summarizer model (any Claude model id or alias). Default: claude-haiku-4-5-20251001.
model: "claude-haiku-4-5-20251001"
```

| Key | Meaning |
|-----|---------|
| `format` | Title template. Tokens: `{project}` (git-root basename of the cwd), `{label}` (generated topic). Unknown `{tokens}` and other text are kept verbatim. |
| `model` | Model used to summarize recent prompts into a topic. Haiku is the cheap, fast default. |

A missing, empty, comment-only, or otherwise unusable config falls back to the
defaults silently — the hook never disrupts the session.

## Requirements

- Claude Code ≥ 2.1.141 (for hook `terminalSequence`), logged in (the summarizer
  reuses this login — no API key needed)
- [bun](https://bun.sh)
- `@anthropic-ai/claude-agent-sdk` (installed by `./run deps`)
- A terminal that honours `OSC 0` window-title sequences

## Install

```sh
./run deps        # bun install + tooling check
./run install     # adds the Stop hook + CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 to settings.json
```

Restart Claude Code (or start a new session) so the env var takes effect. Remove with
`./run uninstall`. `./run doctor` verifies the `claude` CLI, the Agent SDK, and a live
topic generation. Run `./run help` for all commands.

## License

MIT — see [LICENSE](LICENSE).
