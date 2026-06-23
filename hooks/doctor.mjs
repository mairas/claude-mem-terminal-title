#!/usr/bin/env bun
// Checks the moving parts the title hook depends on: the `claude` CLI (the
// summarizer's subscription auth source), the Claude Agent SDK, and a live topic
// generation. Makes one real (~10s) LLM call so a broken login or missing
// dependency surfaces here instead of as a silent no-op in the hook.

import { execFileSync } from "node:child_process";

const ok = (m) => console.log("OK   " + m);
const bad = (m) => console.error("FAIL " + m);
let failed = false;

try {
  const v = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  ok(`claude CLI present (${v}) — provides the summarizer's subscription auth`);
} catch {
  bad("claude CLI not found on PATH — the summarizer authenticates through it");
  failed = true;
}

let query;
try {
  ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  ok("@anthropic-ai/claude-agent-sdk importable");
} catch (e) {
  bad("@anthropic-ai/claude-agent-sdk not installed — run `./run deps`");
  console.error("     " + (e?.message || e));
  failed = true;
}

if (query) {
  const t0 = Date.now();
  try {
    let topic = null;
    for await (const msg of query({
      prompt:
        "Reply with ONLY a 3-6 word topic (no quotes, no preamble) for: verifying the " +
        "claude-mem-terminal-title doctor check.",
      options: {
        model: process.env.CMTT_MODEL || "claude-haiku-4-5-20251001",
        settingSources: [],
        allowedTools: [],
        maxTurns: 1,
      },
    })) {
      if (msg.type === "result" && msg.subtype === "success") topic = msg.result;
    }
    if (topic) ok(`topic generation works (${Date.now() - t0}ms): ${JSON.stringify(topic.trim())}`);
    else {
      bad("topic generation returned no result — is `claude` logged in (subscription)?");
      failed = true;
    }
  } catch (e) {
    bad("topic generation failed — is `claude` logged in (subscription)?");
    console.error("     " + (e?.message || e));
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
