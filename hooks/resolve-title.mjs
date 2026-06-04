// Pure title-resolution logic. Operates on an already-opened bun:sqlite
// Database so it can be unit-tested against an in-memory fixture.

const MAX_LEN = 100;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// Replace C0 control chars and DEL with spaces, then collapse runs. Control
// chars must never reach the OSC sequence — a stray ESC or BEL corrupts it.
function clean(s) {
  let out = "";
  for (const ch of s ?? "") {
    const n = ch.codePointAt(0);
    out += n < 0x20 || n === 0x7f ? " " : ch;
  }
  return out.replace(/ +/g, " ").trim();
}

export function formatTitle(project, request) {
  const p = clean(project);
  const r = clean(request);
  let title = p ? `[${p}] ${r}` : r;
  if (title.length > MAX_LEN) title = title.slice(0, MAX_LEN - 1).trimEnd() + "…";
  return title;
}

// OSC 0: set icon + window title (ESC ] 0 ; <title> BEL). OSC 0 is honoured by
// the widest range of terminals.
export function titleSequence(title) {
  return `${ESC}]0;${title}${BEL}`;
}

// claude-mem labels each row with a project derived from the git root (or cwd
// basename). The authoritative mapping for the active window is its
// content_session_id; cwd basename is a best-effort fallback for the brief
// window before claude-mem registers the session.
export function projectForSession(db, sessionId, cwd) {
  if (sessionId) {
    const row = db
      .query("SELECT project FROM sdk_sessions WHERE content_session_id = ? LIMIT 1")
      .get(sessionId);
    if (row?.project) return row.project;
  }
  if (cwd) return cwd.replace(/\/+$/, "").split("/").pop() || null;
  return null;
}

export function latestRequest(db, project) {
  if (!project) return null;
  const row = db
    .query(
      "SELECT request FROM session_summaries WHERE project = ? AND request IS NOT NULL AND request != '' ORDER BY created_at_epoch DESC LIMIT 1",
    )
    .get(project);
  return row?.request ?? null;
}

export function resolveTitle(db, { sessionId, cwd }) {
  const project = projectForSession(db, sessionId, cwd);
  const request = latestRequest(db, project);
  if (!request) return null;
  return formatTitle(project, request);
}
