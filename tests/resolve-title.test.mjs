import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import {
  resolveTitle,
  formatTitle,
  titleSequence,
  projectForSession,
} from "../hooks/resolve-title.mjs";

function makeDb() {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE sdk_sessions (content_session_id TEXT, project TEXT, started_at_epoch INTEGER)",
  );
  db.run(
    "CREATE TABLE session_summaries (memory_session_id TEXT, project TEXT, request TEXT, created_at_epoch INTEGER)",
  );
  db.run(
    "CREATE TABLE user_prompts (content_session_id TEXT, prompt_number INTEGER, prompt_text TEXT, created_at_epoch INTEGER)",
  );
  return db;
}

const session = (db, id, project) =>
  db.run("INSERT INTO sdk_sessions VALUES (?,?,?)", [id, project, 0]);
const prompt = (db, sid, t) =>
  db.run("INSERT INTO user_prompts VALUES (?,?,?,?)", [sid, 1, "p", t]);
const summary = (db, project, request, t) =>
  db.run("INSERT INTO session_summaries VALUES (?,?,?,?)", ["m", project, request, t]);

test("resolves the latest summary owned by the session's window", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  prompt(db, "sid-1", 50);
  summary(db, "admin", "Design the thing", 100);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/elsewhere" })).toBe(
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
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x" })).toBe("[admin] the real work");
});

test("two same-project windows each get their own summary", () => {
  const db = makeDb();
  session(db, "A", "proj");
  session(db, "B", "proj");
  prompt(db, "A", 10);
  summary(db, "proj", "A's work", 15);
  prompt(db, "B", 20);
  summary(db, "proj", "B's work", 25);
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x" })).toBe("[proj] A's work");
  expect(resolveTitle(db, { sessionId: "B", cwd: "/x" })).toBe("[proj] B's work");
});

test("a window owning no summary yet gets the default, not another window's title", () => {
  const db = makeDb();
  session(db, "A", "proj");
  session(db, "B", "proj");
  prompt(db, "A", 10);
  summary(db, "proj", "A's work", 15);
  prompt(db, "B", 20); // B has prompted but its summary hasn't been generated yet
  expect(resolveTitle(db, { sessionId: "B", cwd: "/x" })).toBe("[proj] Claude Code");
  expect(resolveTitle(db, { sessionId: "A", cwd: "/x" })).toBe("[proj] A's work");
});

test("falls back to '[project] Claude Code' when the project has no summaries", () => {
  const db = makeDb();
  session(db, "sid-1", "empty");
  prompt(db, "sid-1", 10);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x" })).toBe("[empty] Claude Code");
});

test("defaults using the cwd basename when the session is unregistered", () => {
  const db = makeDb();
  expect(resolveTitle(db, { sessionId: "ghost", cwd: "/home/me/myrepo" })).toBe(
    "[myrepo] Claude Code",
  );
});

test("returns null only when no project can be determined", () => {
  const db = makeDb();
  expect(resolveTitle(db, { sessionId: null, cwd: "" })).toBeNull();
});

test("ignores null/empty requests", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  prompt(db, "sid-1", 50);
  summary(db, "admin", "real label", 100);
  summary(db, "admin", "", 200);
  summary(db, "admin", null, 300);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x" })).toBe("[admin] real label");
});

test("projectForSession resolves via content_session_id, falling back to cwd basename", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  expect(projectForSession(db, "sid-1", "/whatever")).toBe("admin");
  expect(projectForSession(db, "unknown", "/home/me/code/myrepo/")).toBe("myrepo");
});

test("formatTitle strips control chars and collapses whitespace", () => {
  const messy = "line1" + String.fromCharCode(10) + "line2" + String.fromCharCode(27) + "x";
  expect(formatTitle("proj", messy)).toBe("[proj] line1 line2 x");
});

test("formatTitle caps length with an ellipsis", () => {
  const long = "x".repeat(200);
  const out = formatTitle("p", long);
  expect(out.length).toBe(100);
  expect(out.endsWith("…")).toBe(true);
});

test("titleSequence wraps the title in OSC 0 (ESC ] 0 ; ... BEL)", () => {
  expect(titleSequence("hi")).toBe(String.fromCharCode(27) + "]0;hi" + String.fromCharCode(7));
});
