import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTopic } from "../hooks/generate.mjs";
import { readCache, writePending } from "../hooks/cache.mjs";
import { titleSequence } from "../hooks/resolve-title.mjs";

// applyTopic does the deterministic part of the updater: render the title, write
// it to the device, and cache it — unless a newer turn has superseded this one.
// The LLM call itself isn't exercised here.
function withEnv(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cmtt-gen-"));
  const cache = join(dir, "cache");
  mkdirSync(cache);
  const repo = join(dir, "proj");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const device = join(dir, "device"); // a plain file stands in for the tty device
  const prev = process.env.CMTT_CACHE_DIR;
  process.env.CMTT_CACHE_DIR = cache;
  try {
    return fn({ dir, repo, device });
  } finally {
    if (prev === undefined) delete process.env.CMTT_CACHE_DIR;
    else process.env.CMTT_CACHE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("applyTopic writes the rendered title to the device and caches the topic", () => {
  withEnv(({ repo, device }) => {
    writePending("S", "k1");
    const wrote = applyTopic({
      device,
      cwd: repo,
      format: undefined,
      sessionId: "S",
      ctxKey: "k1",
      topic: "build the thing",
    });
    expect(wrote).toBe(true);
    expect(readFileSync(device, "utf8")).toBe(titleSequence("[proj] build the thing"));
    expect(readCache("S")).toEqual({ key: "k1", topic: "build the thing" });
  });
});

test("applyTopic honours the configured format", () => {
  withEnv(({ repo, device }) => {
    writePending("S", "k1");
    applyTopic({ device, cwd: repo, format: "🦊 {project} » {label}", sessionId: "S", ctxKey: "k1", topic: "do x" });
    expect(readFileSync(device, "utf8")).toBe(titleSequence("🦊 proj » do x"));
  });
});

test("applyTopic bails when a newer turn has superseded this generation", () => {
  withEnv(({ repo, device }) => {
    writePending("S", "k2"); // a newer turn recorded k2 while this generator was on k1
    const wrote = applyTopic({
      device,
      cwd: repo,
      format: undefined,
      sessionId: "S",
      ctxKey: "k1",
      topic: "stale topic",
    });
    expect(wrote).toBe(false);
    expect(existsSync(device)).toBe(false); // nothing written
    expect(readCache("S")).toBeNull();
  });
});
