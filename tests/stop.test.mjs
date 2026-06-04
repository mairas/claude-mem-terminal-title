import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STOP = new URL("../hooks/stop.mjs", import.meta.url).pathname;

function fixtureDb(dir) {
  const path = join(dir, "claude-mem.db");
  const db = new Database(path);
  db.run("CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, content_session_id TEXT, project TEXT, started_at_epoch INTEGER)");
  db.run("CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, request TEXT, created_at_epoch INTEGER)");
  db.run("CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, content_session_id TEXT, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER)");
  db.run("INSERT INTO sdk_sessions (content_session_id, project, started_at_epoch) VALUES ('S','proj',0)");
  db.run("INSERT INTO user_prompts (content_session_id, prompt_number, prompt_text, created_at_epoch) VALUES ('S',1,'p',10)");
  db.run("INSERT INTO session_summaries (memory_session_id, project, request, created_at_epoch) VALUES ('m','proj','do a thing',20)");
  db.close();
  return path;
}

async function runStop(stdin, env) {
  const proc = Bun.spawn([process.execPath, STOP], {
    stdin: Buffer.from(stdin),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { out, code };
}

test("emits a terminalSequence for a window with an owned summary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmtt-"));
  try {
    const dbPath = fixtureDb(dir);
    const { out, code } = await runStop(
      JSON.stringify({ session_id: "S", cwd: "/x/proj" }),
      { CMTT_DB: dbPath },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out).terminalSequence).toContain("[proj] do a thing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing DB is a silent no-op (no output, exit 0)", async () => {
  const { out, code } = await runStop(
    JSON.stringify({ session_id: "S", cwd: "/x" }),
    { CMTT_DB: "/no/such/db.sqlite" },
  );
  expect(code).toBe(0);
  expect(out).toBe("");
});

test("malformed stdin never throws (exit 0, output is empty or valid JSON)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmtt-"));
  try {
    const dbPath = fixtureDb(dir);
    const { out, code } = await runStop("not json at all", { CMTT_DB: dbPath });
    expect(code).toBe(0);
    if (out) expect(() => JSON.parse(out)).not.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
