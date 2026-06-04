#!/usr/bin/env bun
// Stop hook entrypoint. Reads the Claude Code hook payload from stdin, looks up
// the current task label from claude-mem, and emits a terminalSequence to set
// the window title. Never throws into the session: any failure is a silent
// no-op.

import { Database } from "bun:sqlite";
import { existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveTitle, titleSequence } from "./resolve-title.mjs";

const DB_PATH =
  process.env.CMTT_DB || join(homedir(), ".claude-mem", "claude-mem.db");

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
    const db = new Database(DB_PATH, { readonly: true });
    const title = resolveTitle(db, { sessionId, cwd });
    db.close();
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
