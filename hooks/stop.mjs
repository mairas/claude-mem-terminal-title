#!/usr/bin/env bun
// Stop hook entrypoint. Reads the Claude Code hook payload from stdin and sets
// the window title in two stages: a synchronous placeholder via terminalSequence
// (instant), and — when the conversation has advanced — a detached updater that
// generates a topic with an LLM and writes the final title out of band. Never
// throws into the session: any failure is a silent no-op.

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderTitle,
  titleSequence,
  latestPromptFromTranscript,
  recentPromptsFromTranscript,
  contextKey,
  shouldRegenerate,
  DEFAULT_LABEL,
} from "./resolve-title.mjs";
import { projectForCwd } from "./project.mjs";
import { resolveTerminalDevice } from "./terminal.mjs";
import { readCache, writePending } from "./cache.mjs";

// The hook must never disrupt the session. Guard async paths so any unhandled
// rejection still exits cleanly rather than non-zero.
process.on("unhandledRejection", () => process.exit(0));

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// XDG-style config path, overridable wholesale with CMTT_CONFIG for testing.
const CONFIG_PATH =
  process.env.CMTT_CONFIG ||
  join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "claude-mem-terminal-title.yaml",
  );

// YAML config: `format` (title template) and `model` (summarizer model). A
// missing, empty, comment-only, or malformed file degrades silently to defaults.
function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return Bun.YAML.parse(readFileSync(CONFIG_PATH, "utf8")) ?? {};
  } catch {
    return {};
  }
}

// Set CMTT_DEBUG=1 to log payloads and decisions to ~/.claude-mem-terminal-title.log.
function debug(...parts) {
  if (!process.env.CMTT_DEBUG) return;
  try {
    appendFileSync(join(homedir(), ".claude-mem-terminal-title.log"), parts.join(" ") + "\n");
  } catch {}
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  // Belt-and-suspenders against recursion: the updater runs the summarizer with
  // settings disabled, so this hook should never load inside it — but if it ever
  // did, bail before doing anything.
  if (process.env.CMTT_SUBPROCESS) process.exit(0);

  const raw = await readStdin();
  debug("INPUT", raw);
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {}

  const sessionId = input.session_id ?? null;
  const cwd = input.cwd ?? process.cwd();
  const transcriptPath = input.transcript_path;

  let transcriptText;
  if (transcriptPath && existsSync(transcriptPath)) {
    try {
      transcriptText = readFileSync(transcriptPath, "utf8");
    } catch {}
  }

  const project = projectForCwd(cwd);
  if (!project) process.exit(0);

  const cfg = loadConfig();
  const format = typeof cfg.format === "string" && cfg.format.trim() ? cfg.format : undefined;
  const model = typeof cfg.model === "string" && cfg.model.trim() ? cfg.model.trim() : DEFAULT_MODEL;

  const cached = readCache(sessionId);
  const prompts = recentPromptsFromTranscript(transcriptText);
  const key = contextKey(prompts);

  // Synchronous placeholder: the cached topic (stable across turns) when we have
  // one, else the latest typed prompt, else the default. Emitted via Claude
  // Code's terminalSequence so the title is correct instantly — even on the very
  // first turn, before any topic has been generated.
  const label = (cached && cached.topic) || latestPromptFromTranscript(transcriptText) || DEFAULT_LABEL;
  const title = renderTitle(format, { project, label });
  if (title) {
    process.stdout.write(JSON.stringify({ terminalSequence: titleSequence(title) }));
    debug("EMIT", title);
  }

  // Async refresh: only when the conversation has advanced since the cached
  // topic (so we don't pay for an LLM call every turn) and only if we can find
  // the window's terminal to write to. Fire-and-forget; the hook returns now.
  if (shouldRegenerate({ prompts, key, cached }) && !process.env.CMTT_NO_SPAWN) {
    const device = resolveTerminalDevice(process.pid);
    debug("DEVICE", String(device), "KEY", key, "CACHEDKEY", String(cached && cached.key));
    if (device) {
      // Record this turn as the newest pending generation before spawning, so a
      // slower earlier updater bails instead of overwriting a newer topic.
      writePending(sessionId, key);
      const child = Bun.spawn([process.execPath, join(HERE, "generate.mjs")], {
        env: {
          ...process.env,
          CMTT_SUBPROCESS: "1",
          CMTT_DEVICE: device,
          CMTT_CWD: cwd,
          CMTT_TRANSCRIPT: transcriptPath || "",
          CMTT_SESSION: sessionId || "",
          CMTT_FORMAT: format || "",
          CMTT_MODEL: model,
          CMTT_CTXKEY: key,
        },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      child.unref();
    }
  }
} catch (e) {
  debug("ERROR", e?.stack || String(e));
}
process.exit(0);
