import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STOP = new URL("../hooks/stop.mjs", import.meta.url).pathname;

const typed = (content) =>
  JSON.stringify({ type: "user", promptSource: "typed", message: { role: "user", content } });

// Build a temp tree: a git repo named "proj" (so projectForCwd resolves to
// "proj"), a transcript with the given prompts, and a private cache dir.
function setup(prompts = []) {
  const dir = mkdtempSync(join(tmpdir(), "cmtt-stop-"));
  const repo = join(dir, "proj");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const transcript = join(dir, "session.jsonl");
  writeFileSync(transcript, prompts.map(typed).join("\n"));
  const cache = join(dir, "cache");
  mkdirSync(cache);
  return { dir, repo, transcript, cache };
}

async function runStop(stdin, env) {
  const proc = Bun.spawn([process.execPath, STOP], {
    stdin: Buffer.from(stdin),
    env: {
      ...process.env,
      // Don't pick up the dev machine's real config; don't fire a real LLM call.
      CMTT_CONFIG: "/nonexistent/cmtt/config.yaml",
      CMTT_NO_SPAWN: "1",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { out, code };
}

test("emits the latest typed prompt as the placeholder when there is no cache", async () => {
  const { dir, repo, transcript, cache } = setup(["first thing", "pivoted to a new topic"]);
  try {
    const { out, code } = await runStop(
      JSON.stringify({ session_id: "S", cwd: repo, transcript_path: transcript }),
      { CMTT_CACHE_DIR: cache },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out).terminalSequence).toContain("[proj] pivoted to a new topic");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shows the cached topic when one exists (the stable placeholder)", async () => {
  const { dir, repo, transcript, cache } = setup(["pivoted to a new topic"]);
  try {
    writeFileSync(join(cache, "S.json"), JSON.stringify({ key: "anything", topic: "Cached Topic" }));
    const { out, code } = await runStop(
      JSON.stringify({ session_id: "S", cwd: repo, transcript_path: transcript }),
      { CMTT_CACHE_DIR: cache },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out).terminalSequence).toContain("[proj] Cached Topic");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("falls back to the default label with no transcript and no cache", async () => {
  const { dir, repo, cache } = setup([]);
  try {
    const { out, code } = await runStop(
      JSON.stringify({ session_id: "S", cwd: repo }),
      { CMTT_CACHE_DIR: cache },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out).terminalSequence).toContain("[proj] Claude Code");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a config format template controls the title", async () => {
  const { dir, repo, transcript, cache } = setup(["do the work"]);
  try {
    const cfg = join(dir, "config.yaml");
    writeFileSync(cfg, 'format: "{project} » {label}"\n');
    const { out, code } = await runStop(
      JSON.stringify({ session_id: "S", cwd: repo, transcript_path: transcript }),
      { CMTT_CACHE_DIR: cache, CMTT_CONFIG: cfg },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out).terminalSequence).toContain("proj » do the work");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the recursion guard makes the hook a no-op", async () => {
  const { dir, repo, transcript, cache } = setup(["do the work"]);
  try {
    const { out, code } = await runStop(
      JSON.stringify({ session_id: "S", cwd: repo, transcript_path: transcript }),
      { CMTT_CACHE_DIR: cache, CMTT_SUBPROCESS: "1" },
    );
    expect(code).toBe(0);
    expect(out).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed stdin never throws (exit 0, output empty or valid JSON)", async () => {
  const { dir, cache } = setup([]);
  try {
    const { out, code } = await runStop("not json at all", { CMTT_CACHE_DIR: cache });
    expect(code).toBe(0);
    if (out) expect(() => JSON.parse(out)).not.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
