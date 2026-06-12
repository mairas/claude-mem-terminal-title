import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import {
  resolveTitle,
  renderTitle,
  titleSequence,
  projectForSession,
  DEFAULT_FORMAT,
} from "../hooks/resolve-title.mjs";

// The correlation/fallback tests pin the default format explicitly; template
// behaviour has its own tests at the bottom.
const PLAIN = DEFAULT_FORMAT;

// Fixture: a subset of claude-mem's schema (verified against v13.5.6) holding
// only the columns the resolver queries touch. Named-column inserts so a column
// reordering upstream wouldn't silently pass. `./run doctor` checks the real DB.
function makeDb() {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, content_session_id TEXT, memory_session_id TEXT, project TEXT, user_prompt TEXT, started_at_epoch INTEGER)",
  );
  db.run(
    "CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, request TEXT, prompt_number INTEGER, created_at_epoch INTEGER)",
  );
  db.run(
    "CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, content_session_id TEXT, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER)",
  );
  return db;
}

const session = (db, id, project, { memoryId = null, firstPrompt = null } = {}) =>
  db.run(
    "INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, user_prompt, started_at_epoch) VALUES (?,?,?,?,?)",
    [id, memoryId, project, firstPrompt, 0],
  );
const prompt = (db, sid, t, promptNumber = 1) =>
  db.run("INSERT INTO user_prompts (content_session_id, prompt_number, prompt_text, created_at_epoch) VALUES (?,?,?,?)", [sid, promptNumber, "p", t]);
const summary = (db, project, request, t, { memoryId = "m", promptNumber = null } = {}) =>
  db.run("INSERT INTO session_summaries (memory_session_id, project, request, prompt_number, created_at_epoch) VALUES (?,?,?,?,?)", [memoryId, project, request, promptNumber, t]);

test("resolves the latest summary owned by the session's window", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  prompt(db, "sid-1", 50);
  summary(db, "admin", "Design the thing", 100);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/elsewhere", format: PLAIN })).toBe(
    "[admin] Design the thing",
  );
});

test("picks the newest owned summary by created_at_epoch", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  prompt(db, "sid-1", 50);
  prompt(db, "sid-1", 150);
  summary(db, "admin", "old cleanup task", 100);
  summary(db, "admin", "the real work", 200);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x", format: PLAIN })).toBe("[admin] the real work");
});

test("two same-project windows each get their own summary", () => {
  const db = makeDb();
  session(db, "A", "proj");
  session(db, "B", "proj");
  prompt(db, "A", 10);
  summary(db, "proj", "A's work", 15);
  prompt(db, "B", 20);
  summary(db, "proj", "B's work", 25);
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe("[proj] A's work");
  expect(resolveTitle(db, { sessionId: "B", cwd: "/x", format: PLAIN })).toBe("[proj] B's work");
});

test("equal-epoch prompts: each window deterministically claims the tie", () => {
  const db = makeDb();
  session(db, "A", "proj");
  session(db, "B", "proj");
  prompt(db, "A", 100);
  prompt(db, "B", 100);
  summary(db, "proj", "S", 110);
  // Tiebreaker prefers the querying session, so neither is silently dropped.
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe("[proj] S");
  expect(resolveTitle(db, { sessionId: "B", cwd: "/x", format: PLAIN })).toBe("[proj] S");
});

test("a summary stamped with the session's current memory id wins over prompt timing", () => {
  const db = makeDb();
  session(db, "A", "proj", { memoryId: "mem-A" });
  session(db, "B", "proj", { memoryId: "mem-B" });
  prompt(db, "A", 10);
  // B prompts after A, just before A's summary lands: the old time heuristic
  // would hand A's summary to B.
  prompt(db, "B", 20);
  summary(db, "proj", "A's work", 30, { memoryId: "mem-A", promptNumber: 1 });
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe("[proj] A's work");
  expect(resolveTitle(db, { sessionId: "B", cwd: "/x", format: PLAIN })).not.toBe("[proj] A's work");
});

test("a summary owned by another live session is never shown to a different window", () => {
  const db = makeDb();
  session(db, "A", "proj", { memoryId: "mem-A" });
  session(db, "B", "proj", { memoryId: "mem-B" });
  // Only A ever prompted before the summary, so time correlation points at A —
  // but the summary is stamped as B's, which is authoritative.
  prompt(db, "A", 10);
  summary(db, "proj", "B's work", 20, { memoryId: "mem-B", promptNumber: 1 });
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe("[proj] Claude Code");
  expect(resolveTitle(db, { sessionId: "B", cwd: "/x", format: PLAIN })).toBe("[proj] B's work");
});

test("an orphaned summary is attributed via matching prompt_number", () => {
  const db = makeDb();
  // claude-mem rotated both windows' memory ids, orphaning the summary: its
  // memory id is on no session row. A is on prompt 2, B on prompt 1. B prompted
  // most recently before the summary, but the summary's prompt_number says 2.
  session(db, "A", "proj", { memoryId: "mem-A2" });
  session(db, "B", "proj", { memoryId: "mem-B1" });
  prompt(db, "A", 10, 1);
  prompt(db, "A", 30, 2);
  prompt(db, "B", 40, 1);
  summary(db, "proj", "A's second task", 50, { memoryId: "mem-A1", promptNumber: 2 });
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe("[proj] A's second task");
  expect(resolveTitle(db, { sessionId: "B", cwd: "/x", format: PLAIN })).not.toBe("[proj] A's second task");
});

test("falls back to the session's first prompt when no summary is attributable", () => {
  const db = makeDb();
  session(db, "A", "proj", { memoryId: "mem-A", firstPrompt: "Fix the flux capacitor" });
  prompt(db, "A", 10);
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe(
    "[proj] Fix the flux capacitor",
  );
});

test("an empty-string opening prompt falls through to the default label", () => {
  const db = makeDb();
  session(db, "A", "proj", { memoryId: "mem-A", firstPrompt: "" });
  prompt(db, "A", 10);
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe("[proj] Claude Code");
});

test("an orphaned summary whose prompt_number matches no prompt is not attributed", () => {
  const db = makeDb();
  session(db, "A", "proj", { memoryId: "mem-A2" });
  prompt(db, "A", 10, 1);
  // The orphan's anchor (prompt 7) exists in no window, so nobody may claim it.
  summary(db, "proj", "stray work", 50, { memoryId: "mem-gone", promptNumber: 7 });
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe("[proj] Claude Code");
});

test("an attributable summary still wins over the first-prompt fallback", () => {
  const db = makeDb();
  session(db, "A", "proj", { memoryId: "mem-A", firstPrompt: "Fix the flux capacitor" });
  prompt(db, "A", 10);
  summary(db, "proj", "Replace the plutonium", 20, { memoryId: "mem-A", promptNumber: 1 });
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe(
    "[proj] Replace the plutonium",
  );
});

test("a window owning no summary yet gets the default, not another window's title", () => {
  const db = makeDb();
  session(db, "A", "proj");
  session(db, "B", "proj");
  prompt(db, "A", 10);
  summary(db, "proj", "A's work", 15);
  prompt(db, "B", 20);
  expect(resolveTitle(db, { sessionId: "B", cwd: "/x", format: PLAIN })).toBe("[proj] Claude Code");
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x", format: PLAIN })).toBe("[proj] A's work");
});

test("falls back to '[project] Claude Code' when the project has no summaries", () => {
  const db = makeDb();
  session(db, "sid-1", "empty");
  prompt(db, "sid-1", 10);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x", format: PLAIN })).toBe("[empty] Claude Code");
});

test("defaults using the cwd basename when the session is unregistered", () => {
  const db = makeDb();
  expect(resolveTitle(db, { sessionId: "ghost", cwd: "/home/me/myrepo", format: PLAIN })).toBe(
    "[myrepo] Claude Code",
  );
});

test("returns null only when no project can be determined", () => {
  const db = makeDb();
  expect(resolveTitle(db, { sessionId: null, cwd: "", format: PLAIN })).toBeNull();
});

test("ignores null/empty requests", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  prompt(db, "sid-1", 50);
  summary(db, "admin", "real label", 100);
  summary(db, "admin", "", 200);
  summary(db, "admin", null, 300);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x", format: PLAIN })).toBe("[admin] real label");
});

test("projectForSession resolves via content_session_id, falling back to cwd basename", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  expect(projectForSession(db, "sid-1", "/whatever")).toBe("admin");
  expect(projectForSession(db, "unknown", "/home/me/code/myrepo/")).toBe("myrepo");
});

test("resolveTitle uses the default format when none is given", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  prompt(db, "sid-1", 50);
  summary(db, "admin", "do a thing", 100);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x" })).toBe("[admin] do a thing");
});

test("renderTitle substitutes {project} and {label}", () => {
  expect(renderTitle("[{project}] {label}", { project: "p", label: "do x" })).toBe("[p] do x");
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
  // A config template carrying raw BEL/ESC must not survive into the title and
  // break out of the OSC 0 sequence the hook wraps it in.
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const out = renderTitle(`${BEL}${ESC}]0;PWNED${BEL}[{project}]`, { project: "p", label: "x" });
  expect(out.includes(ESC)).toBe(false);
  expect(out.includes(BEL)).toBe(false);
  // Control chars collapse to spaces, so the payload can't close/reopen OSC.
  expect(out).toBe("]0;PWNED [p]");
});

test("truncation keeps a single-codepoint glyph intact and caps at MAX_LEN", () => {
  const out = renderTitle("🦊 {label}", { project: "", label: "x".repeat(200) });
  expect([...out].length).toBe(100);
  expect(out.startsWith("🦊 ")).toBe(true);
  expect(out.endsWith("…")).toBe(true);
});

test("renderTitle caps length with an ellipsis", () => {
  const out = renderTitle("[{project}] {label}", { project: "p", label: "x".repeat(200) });
  expect([...out].length).toBe(100);
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
