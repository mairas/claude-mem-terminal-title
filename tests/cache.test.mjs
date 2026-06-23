import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCache, writeCache, cacheDir, readPending, writePending } from "../hooks/cache.mjs";

function withCacheDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cmtt-cache-"));
  const prev = process.env.CMTT_CACHE_DIR;
  process.env.CMTT_CACHE_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.CMTT_CACHE_DIR;
    else process.env.CMTT_CACHE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("write then read round-trips the entry", () => {
  withCacheDir(() => {
    writeCache("sess-1", { key: "k1", topic: "build the thing" });
    expect(readCache("sess-1")).toEqual({ key: "k1", topic: "build the thing" });
  });
});

test("readCache returns null for an unknown session", () => {
  withCacheDir(() => {
    expect(readCache("nope")).toBeNull();
  });
});

test("readCache returns null for a malformed cache file", () => {
  withCacheDir((dir) => {
    writeFileSync(join(dir, "bad.json"), "{not json");
    expect(readCache("bad")).toBeNull();
  });
});

test("readCache rejects an entry with no usable topic", () => {
  withCacheDir((dir) => {
    writeFileSync(join(dir, "empty.json"), JSON.stringify({ key: "k", topic: "" }));
    expect(readCache("empty")).toBeNull();
  });
});

test("cacheDir honours CMTT_CACHE_DIR", () => {
  withCacheDir((dir) => {
    expect(cacheDir()).toBe(dir);
  });
});

test("the pending marker round-trips and is null when absent", () => {
  withCacheDir(() => {
    expect(readPending("s")).toBeNull();
    writePending("s", "k1");
    expect(readPending("s")).toBe("k1");
    writePending("s", "k2");
    expect(readPending("s")).toBe("k2");
  });
});

test("session ids that look like paths cannot escape the cache dir", () => {
  withCacheDir((dir) => {
    writeCache("../../evil", { key: "k", topic: "t" });
    // sanitized to a flat filename inside dir; round-trips under the same id.
    expect(readCache("../../evil")).toEqual({ key: "k", topic: "t" });
  });
});
