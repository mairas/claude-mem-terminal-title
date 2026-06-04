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
  return db;
}

const session = (db, id, project) =>
  db.run("INSERT INTO sdk_sessions VALUES (?,?,?)", [id, project, 0]);
const summary = (db, project, request, t) =>
  db.run("INSERT INTO session_summaries VALUES (?,?,?,?)", ["m", project, request, t]);

test("resolves the project via content_session_id, not cwd", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  summary(db, "admin", "Design the thing", 100);
  const title = resolveTitle(db, { sessionId: "sid-1", cwd: "/somewhere/else" });
  expect(title).toBe("[admin] Design the thing");
});

test("picks the newest summary by created_at_epoch", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  summary(db, "admin", "old cleanup task", 100);
  summary(db, "admin", "the real work", 200);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x" })).toBe("[admin] the real work");
});

test("falls back to cwd basename when the session is not yet registered", () => {
  const db = makeDb();
  summary(db, "myrepo", "doing stuff", 100);
  expect(projectForSession(db, "unknown-sid", "/home/me/code/myrepo/")).toBe("myrepo");
  expect(resolveTitle(db, { sessionId: "unknown-sid", cwd: "/home/me/code/myrepo" })).toBe(
    "[myrepo] doing stuff",
  );
});

test("returns null when the project has no summaries", () => {
  const db = makeDb();
  session(db, "sid-1", "empty");
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x" })).toBeNull();
});

test("ignores null/empty requests", () => {
  const db = makeDb();
  session(db, "sid-1", "admin");
  summary(db, "admin", "real label", 100);
  summary(db, "admin", "", 200);
  summary(db, "admin", null, 300);
  expect(resolveTitle(db, { sessionId: "sid-1", cwd: "/x" })).toBe("[admin] real label");
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
