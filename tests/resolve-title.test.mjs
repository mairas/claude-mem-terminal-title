import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import {
  resolveTitle,
  renderTitle,
  emojiForSession,
  titleSequence,
  projectForSession,
  DEFAULT_FORMAT,
  EMOJI_PALETTE,
} from "../hooks/resolve-title.mjs";

// The correlation/fallback tests below assert on the label, not the emoji, so
// they pin an emoji-free format. Emoji and template behaviour have their own
// tests at the bottom.
const PLAIN = "[{project}] {label}";

// Fixture: a subset of claude-mem's schema (verified against v13.4.0) holding
// only the columns the resolver queries touch. Named-column inserts so a column
// reordering upstream wouldn't silently pass. `./run doctor` checks the real DB.
function makeDb() {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE sdk_sessions (id INTEGER PRIMARY KEY, content_session_id TEXT, project TEXT, started_at_epoch INTEGER)",
  );
  db.run(
    "CREATE TABLE session_summaries (id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, request TEXT, created_at_epoch INTEGER)",
  );
  db.run(
    "CREATE TABLE user_prompts (id INTEGER PRIMARY KEY, content_session_id TEXT, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER)",
  );
  return db;
}

const session = (db, id, project) =>
  db.run("INSERT INTO sdk_sessions (content_session_id, project, started_at_epoch) VALUES (?,?,?)", [id, project, 0]);
const prompt = (db, sid, t) =>
  db.run("INSERT INTO user_prompts (content_session_id, prompt_number, prompt_text, created_at_epoch) VALUES (?,?,?,?)", [sid, 1, "p", t]);
const summary = (db, project, request, t) =>
  db.run("INSERT INTO session_summaries (memory_session_id, project, request, created_at_epoch) VALUES (?,?,?,?)", ["m", project, request, t]);

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

test("resolveTitle uses the default format (emoji prefix) when none is given", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  prompt(db, "sid-1", 50);
  summary(db, "admin", "do a thing", 100);
  const out = resolveTitle(db, { sessionId: "sid-1", cwd: "/x" });
  expect(out).toBe(`${emojiForSession("sid-1")} [admin] do a thing`);
});

test("emojiForSession is deterministic, stable, and drawn from the palette", () => {
  const a = emojiForSession("session-abc");
  expect(emojiForSession("session-abc")).toBe(a);
  // A single code point, and non-empty.
  expect([...a].length).toBe(1);
  expect(a.length).toBeGreaterThan(0);
});

test("emojiForSession differs across distinct sessions (no global collapse)", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `sess-${i}`);
  const distinct = new Set(ids.map(emojiForSession));
  expect(distinct.size).toBeGreaterThan(1);
});

test("emojiForSession returns empty string for a missing session id", () => {
  expect(emojiForSession(null)).toBe("");
  expect(emojiForSession("")).toBe("");
});

test("renderTitle substitutes all three tokens", () => {
  expect(renderTitle("{emoji} [{project}] {label}", { emoji: "🦊", project: "p", label: "do x" })).toBe(
    "🦊 [p] do x",
  );
});

test("renderTitle leaves unknown tokens literal", () => {
  expect(renderTitle("{project}/{branch}", { emoji: "🦊", project: "p", label: "x" })).toBe(
    "p/{branch}",
  );
});

test("an empty token leaves no gap (collapsed and trimmed)", () => {
  // No emoji -> the default format must not start with a stray space.
  expect(renderTitle(DEFAULT_FORMAT, { emoji: "", project: "p", label: "x" })).toBe("[p] x");
});

test("renderTitle cleans control chars in dynamic values", () => {
  const messy = "a" + String.fromCharCode(27) + "b" + String.fromCharCode(0x9c) + "c";
  expect(renderTitle("[{project}] {label}", { emoji: "", project: messy, label: "x" })).toBe(
    "[a b c] x",
  );
});

test("renderTitle cleans control chars in the template itself (no OSC injection)", () => {
  // A config template carrying raw BEL/ESC must not survive into the title and
  // break out of the OSC 0 sequence the hook wraps it in.
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const out = renderTitle(`${BEL}${ESC}]0;PWNED${BEL}[{project}]`, { emoji: "", project: "p", label: "x" });
  expect(out.includes(ESC)).toBe(false);
  expect(out.includes(BEL)).toBe(false);
  // Control chars collapse to spaces, so the payload can't close/reopen OSC.
  expect(out).toBe("]0;PWNED [p]");
});

test("every palette emoji is a single code point (truncation-safety invariant)", () => {
  for (const e of EMOJI_PALETTE) expect([...e].length).toBe(1);
});

test("emojiForSession always returns a palette member", () => {
  const members = new Set(EMOJI_PALETTE);
  for (let i = 0; i < 200; i++) expect(members.has(emojiForSession(`sess-${i}`))).toBe(true);
});

test("truncation keeps an emoji prefix intact and caps at MAX_LEN", () => {
  const out = renderTitle("{emoji} {label}", { emoji: "🦊", project: "", label: "x".repeat(200) });
  expect([...out].length).toBe(100);
  expect(out.startsWith("🦊 ")).toBe(true);
  expect(out.endsWith("…")).toBe(true);
});

test("renderTitle caps length with an ellipsis", () => {
  const out = renderTitle("[{project}] {label}", { emoji: "", project: "p", label: "x".repeat(200) });
  expect([...out].length).toBe(100);
  expect(out.endsWith("…")).toBe(true);
});

test("renderTitle truncation never splits a surrogate pair", () => {
  const out = renderTitle("{label}", { emoji: "", project: "", label: "😀".repeat(200) });
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
