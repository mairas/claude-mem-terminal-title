import { test, expect } from "bun:test";
import {
  renderTitle,
  titleSequence,
  latestPromptFromTranscript,
  recentPromptsFromTranscript,
  contextKey,
  shouldRegenerate,
} from "../hooks/resolve-title.mjs";

// A transcript line in Claude Code's JSONL format.
const tline = (obj) => JSON.stringify(obj);
const typedPrompt = (content, promptSource = "typed") =>
  tline({ type: "user", promptSource, message: { role: "user", content } });

// --- latestPromptFromTranscript -------------------------------------------

test("latestPromptFromTranscript returns the newest typed human prompt", () => {
  const text = [typedPrompt("the first thing"), typedPrompt("the current thing")].join("\n");
  expect(latestPromptFromTranscript(text)).toBe("the current thing");
});

test("latestPromptFromTranscript accepts a queued human prompt", () => {
  expect(latestPromptFromTranscript(typedPrompt("queued topic", "queued"))).toBe("queued topic");
});

test("latestPromptFromTranscript skips slash commands and injected notifications", () => {
  const text = [
    typedPrompt("the real prompt"),
    tline({ type: "user", promptSource: "system", message: { role: "user", content: "/effort ultracode" } }),
    tline({ type: "user", origin: { kind: "task-notification" }, message: { role: "user", content: "task done" } }),
  ].join("\n");
  expect(latestPromptFromTranscript(text)).toBe("the real prompt");
});

test("latestPromptFromTranscript skips a newer typed record with array content and keeps scanning", () => {
  // A typed record whose content is an array (e.g. an image/paste attachment) is
  // not a usable label; the walk must fall through to the older string prompt.
  const text = [
    typedPrompt("older good prompt"),
    tline({ type: "user", promptSource: "typed", message: { role: "user", content: [{ type: "text", text: "newer but array" }] } }),
  ].join("\n");
  expect(latestPromptFromTranscript(text)).toBe("older good prompt");
});

test("latestPromptFromTranscript ignores a truncated final line", () => {
  const text = [
    typedPrompt("good prompt"),
    '{"type":"user","promptSource":"typed","message":{"role":"user","content":"trun', // partial write
  ].join("\n");
  expect(latestPromptFromTranscript(text)).toBe("good prompt");
});

test("latestPromptFromTranscript returns null when no usable prompt exists", () => {
  expect(latestPromptFromTranscript("")).toBeNull();
  expect(latestPromptFromTranscript(undefined)).toBeNull();
  expect(latestPromptFromTranscript(typedPrompt("   "))).toBeNull();
  expect(latestPromptFromTranscript(tline({ type: "assistant", message: { content: "hi" } }))).toBeNull();
});

// --- recentPromptsFromTranscript ------------------------------------------

test("recentPromptsFromTranscript returns the recent typed prompts oldest-first", () => {
  const text = [typedPrompt("one"), typedPrompt("two"), typedPrompt("three")].join("\n");
  expect(recentPromptsFromTranscript(text)).toEqual(["one", "two", "three"]);
});

test("recentPromptsFromTranscript respects the limit, keeping the newest", () => {
  const text = ["a", "b", "c", "d"].map((p) => typedPrompt(p)).join("\n");
  expect(recentPromptsFromTranscript(text, 2)).toEqual(["c", "d"]);
});

test("recentPromptsFromTranscript excludes non-typed and array-content records", () => {
  const text = [
    typedPrompt("real one"),
    tline({ type: "user", promptSource: "system", message: { role: "user", content: "/clear" } }),
    tline({ type: "user", promptSource: "typed", message: { role: "user", content: [{ type: "tool_result" }] } }),
    typedPrompt("real two", "queued"),
  ].join("\n");
  expect(recentPromptsFromTranscript(text)).toEqual(["real one", "real two"]);
});

test("recentPromptsFromTranscript returns [] when there are no prompts", () => {
  expect(recentPromptsFromTranscript("")).toEqual([]);
  expect(recentPromptsFromTranscript(undefined)).toEqual([]);
});

// --- contextKey -----------------------------------------------------------

test("contextKey is stable for the same prompts and differs when they change", () => {
  expect(contextKey(["a", "b"])).toBe(contextKey(["a", "b"]));
  expect(contextKey(["a", "b"])).not.toBe(contextKey(["a", "b", "c"]));
  expect(contextKey(["a", "b"])).not.toBe(contextKey(["a", "x"]));
});

test("contextKey handles empty input", () => {
  expect(typeof contextKey([])).toBe("string");
  expect(contextKey([])).toBe(contextKey(undefined));
});

// --- shouldRegenerate ------------------------------------------------------

test("shouldRegenerate: true when there are prompts and the key differs from cache", () => {
  expect(shouldRegenerate({ prompts: ["a"], key: "k1", cached: null })).toBe(true);
  expect(shouldRegenerate({ prompts: ["a"], key: "k1", cached: { key: "k0", topic: "t" } })).toBe(true);
});

test("shouldRegenerate: false when the cached key matches (debounce)", () => {
  expect(shouldRegenerate({ prompts: ["a"], key: "k1", cached: { key: "k1", topic: "t" } })).toBe(false);
});

test("shouldRegenerate: false when there are no prompts", () => {
  expect(shouldRegenerate({ prompts: [], key: "k1", cached: null })).toBe(false);
});

// --- renderTitle / titleSequence ------------------------------------------

test("renderTitle substitutes {project} and {label}", () => {
  expect(renderTitle("[{project}] {label}", { project: "p", label: "do x" })).toBe("[p] do x");
});

test("renderTitle uses the default format when none is given", () => {
  expect(renderTitle(undefined, { project: "admin", label: "do a thing" })).toBe("[admin] do a thing");
});

test("renderTitle keeps a literal emoji in the template", () => {
  expect(renderTitle("🦊 {project} › {label}", { project: "p", label: "x" })).toBe("🦊 p › x");
});

test("renderTitle leaves unknown tokens (including a stray {emoji}) literal", () => {
  expect(renderTitle("{emoji} {project}/{branch}", { project: "p", label: "x" })).toBe(
    "{emoji} p/{branch}",
  );
});

test("an empty token leaves no gap (collapsed and trimmed)", () => {
  expect(renderTitle("{project} {label}", { project: "", label: "x" })).toBe("x");
});

test("renderTitle cleans control chars in dynamic values", () => {
  const messy = "a" + String.fromCharCode(27) + "b" + String.fromCharCode(0x9c) + "c";
  expect(renderTitle("[{project}] {label}", { project: messy, label: "x" })).toBe("[a b c] x");
});

test("renderTitle cleans control chars in the template itself (no OSC injection)", () => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const out = renderTitle(`${BEL}${ESC}]0;PWNED${BEL}[{project}]`, { project: "p", label: "x" });
  expect(out.includes(ESC)).toBe(false);
  expect(out.includes(BEL)).toBe(false);
  expect(out).toBe("]0;PWNED [p]");
});

test("truncation keeps a single-codepoint glyph intact and caps at MAX_LEN", () => {
  const out = renderTitle("🦊 {label}", { project: "", label: "x".repeat(200) });
  expect([...out].length).toBe(100);
  expect(out.startsWith("🦊 ")).toBe(true);
  expect(out.endsWith("…")).toBe(true);
});

test("renderTitle truncation never splits a surrogate pair", () => {
  const out = renderTitle("{label}", { project: "", label: "😀".repeat(200) });
  const lone = [...out].some((ch) => {
    const c = ch.codePointAt(0);
    return c >= 0xd800 && c <= 0xdfff;
  });
  expect(lone).toBe(false);
  expect([...out].length).toBe(100);
});

test("titleSequence wraps the title in OSC 0 (ESC ] 0 ; ... BEL)", () => {
  expect(titleSequence("hi")).toBe(String.fromCharCode(27) + "]0;hi" + String.fromCharCode(7));
});
