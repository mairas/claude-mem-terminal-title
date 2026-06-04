#!/usr/bin/env bun
// Stop hook entrypoint. Reads the Claude Code hook payload from stdin, looks up
// the current task label from claude-mem, and emits a terminalSequence to set
// the window title. Never throws into the session: any failure is a silent
// no-op.

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveTitle, titleSequence } from "./resolve-title.mjs";

// The hook must never disrupt the session. Guard the async paths so any
// unhandled rejection still exits cleanly rather than non-zero.
process.on("unhandledRejection", () => process.exit(0));

const DB_PATH =
  process.env.CMTT_DB || join(homedir(), ".claude-mem", "claude-mem.db");

// XDG-style config path, overridable wholesale with CMTT_CONFIG (a full file
// path) for testing or non-standard layouts.
const CONFIG_PATH =
  process.env.CMTT_CONFIG ||
  join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "claude-mem-terminal-title.yaml",
  );

// Returns the user's `format` template, or undefined to let resolveTitle use its
// default. The config is YAML (parsed via Bun's built-in Bun.YAML); a missing,
// empty, comment-only, or malformed file is not an error — like everything else
// in this hook, it degrades silently to the default. An empty or whitespace-only
// format is treated as absent so it can't render a blank title (which the emit
// guard would drop, leaving the window's previous title stale).
function loadFormat() {
  try {
    if (!existsSync(CONFIG_PATH)) return undefined;
    const cfg = Bun.YAML.parse(readFileSync(CONFIG_PATH, "utf8")) ?? {};
    const format = cfg?.format;
    return typeof format === "string" && format.trim() ? format : undefined;
  } catch {
    return undefined;
  }
}

// Set CMTT_DEBUG=1 to log payloads and emitted sequences to
// ~/.claude-mem-terminal-title.log.
function debug(...parts) {
  if (!process.env.CMTT_DEBUG) return;
  try {
    appendFileSync(
      join(homedir(), ".claude-mem-terminal-title.log"),
      parts.join(" ") + "\n",
    );
  } catch {}
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const raw = await readStdin();
  debug("INPUT", raw);
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {}
  const sessionId = input.session_id ?? null;
  const cwd = input.cwd ?? process.cwd();

  if (existsSync(DB_PATH)) {
    // Imported here, not at module top, so a missing bun:sqlite builtin is
    // caught and no-ops instead of failing module load with a non-zero exit.
    const { Database } = await import("bun:sqlite");
    const db = new Database(DB_PATH, { readonly: true });
    let title;
    try {
      title = resolveTitle(db, { sessionId, cwd, format: loadFormat() });
    } finally {
      db.close();
    }
    debug("SESSION", String(sessionId), "CWD", String(cwd), "TITLE", JSON.stringify(title));
    if (title) {
      const out = JSON.stringify({ terminalSequence: titleSequence(title) });
      debug("EMIT", JSON.stringify(out));
      process.stdout.write(out);
    }
  }
} catch (e) {
  debug("ERROR", e?.stack || String(e));
}
process.exit(0);
