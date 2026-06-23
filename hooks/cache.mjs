import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Per-session topic cache. Lets the synchronous Stop hook show the last
// generated topic instantly, and lets it skip regenerating when the conversation
// hasn't advanced. CMTT_CACHE_DIR overrides the location (used by tests).
export function cacheDir() {
  return (
    process.env.CMTT_CACHE_DIR ||
    join(
      process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
      "claude-mem-terminal-title",
    )
  );
}

function cacheFile(sessionId) {
  // sessionId is a Claude Code UUID; sanitize defensively so it can't escape the
  // cache directory.
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9_-]/g, "_");
  return join(cacheDir(), safe + ".json");
}

// Returns { key, topic } or null. Never throws.
export function readCache(sessionId) {
  try {
    const f = cacheFile(sessionId);
    if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, "utf8"));
    return o && typeof o.topic === "string" && o.topic ? o : null;
  } catch {
    return null;
  }
}

// Persist { key, topic }. Best-effort: a failure to write just means the next
// turn regenerates. Never throws.
export function writeCache(sessionId, entry) {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(cacheFile(sessionId), JSON.stringify(entry));
  } catch {}
}

function pendingFile(sessionId) {
  return cacheFile(sessionId).replace(/\.json$/, ".pending");
}

// The context key of the most recently spawned updater for a session. The Stop
// hook records it before spawning; each updater checks it is still the newest
// before writing the title, so a slower older generator can't overwrite a newer
// one's topic (or leave a stale title) when prompts arrive in quick succession.
export function writePending(sessionId, key) {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(pendingFile(sessionId), String(key));
  } catch {}
}

export function readPending(sessionId) {
  try {
    const f = pendingFile(sessionId);
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  } catch {
    return null;
  }
}
