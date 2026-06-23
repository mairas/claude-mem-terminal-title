#!/usr/bin/env bun
// Detached topic updater. The Stop hook spawns this fire-and-forget and returns
// immediately, so the (slow) LLM call never blocks the session. When the topic
// is ready this writes the OSC title straight to the window's terminal device —
// out of band, seconds after the hook already returned — and caches it for the
// next turn. Parameters arrive via the environment; any failure is a silent
// no-op.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { recentPromptsFromTranscript, renderTitle, titleSequence } from "./resolve-title.mjs";
import { projectForCwd } from "./project.mjs";
import { readPending, writeCache } from "./cache.mjs";

process.on("unhandledRejection", () => process.exit(0));

// Bound a stuck call. The SDK spawns the `claude` CLI and streams from it; if
// that stalls, the for-await would never resolve and this detached process would
// linger forever (and accumulate, one per topic change). The abort controller
// ends the query; the hard timer guarantees the process dies even if abort
// doesn't propagate. Both are well above the observed ~6-13s call time.
const ABORT_MS = 35000;
const HARD_MS = 45000;

const device = process.env.CMTT_DEVICE;
const cwd = process.env.CMTT_CWD || process.cwd();
const transcriptPath = process.env.CMTT_TRANSCRIPT;
const sessionId = process.env.CMTT_SESSION || null;
const format = process.env.CMTT_FORMAT || undefined;
const model = process.env.CMTT_MODEL || "claude-haiku-4-5-20251001";
const ctxKey = process.env.CMTT_CTXKEY || "";

// Summarize the recent prompts into a short topic via the Claude Agent SDK.
// settingSources:[] runs the spawned `claude` in isolation — no user settings,
// so no hooks fire (no recursion into the Stop hook) and claude-mem never sees
// it (no throwaway sessions). Subscription auth; no API key required.
async function generateTopic(prompts) {
  const context = prompts.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const prompt =
    "You write short terminal window titles. Read these recent messages from a " +
    "coding session and reply with ONLY a 3-6 word topic describing what the user " +
    "is working on. No quotes, no trailing punctuation, no preamble.\n\n" +
    context;
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ABORT_MS);
  let result = null;
  try {
    for await (const msg of query({
      prompt,
      options: { model, settingSources: [], allowedTools: [], maxTurns: 1, abortController: ac },
    })) {
      if (msg.type === "result" && msg.subtype === "success") result = msg.result;
    }
  } finally {
    clearTimeout(timer);
  }
  return result ? result.trim() : null;
}

// Render and write the title for a generated topic — unless a newer turn has
// already superseded this one (its key is no longer the pending key). Exported
// for testing without the LLM. Returns whether it wrote.
export function applyTopic({ device, cwd, format, sessionId, ctxKey, topic }) {
  if (readPending(sessionId) !== ctxKey) return false; // a newer turn won
  const title = renderTitle(format, { project: projectForCwd(cwd), label: topic });
  if (!title) return false;
  try {
    writeFileSync(device, titleSequence(title));
  } catch {}
  writeCache(sessionId, { key: ctxKey, topic });
  return true;
}

if (import.meta.main) {
  const hard = setTimeout(() => process.exit(0), HARD_MS);
  try {
    if (!device || !transcriptPath || !existsSync(transcriptPath)) process.exit(0);
    const prompts = recentPromptsFromTranscript(readFileSync(transcriptPath, "utf8"));
    if (!prompts.length) process.exit(0);

    const topic = await generateTopic(prompts);
    if (topic) applyTopic({ device, cwd, format, sessionId, ctxKey, topic });
  } catch {}
  clearTimeout(hard);
  process.exit(0);
}
