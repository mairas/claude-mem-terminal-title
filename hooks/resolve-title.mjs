// Pure title-resolution logic. Operates on an already-opened bun:sqlite
// Database so it can be unit-tested against an in-memory fixture.

const MAX_LEN = 100;
const DEFAULT_LABEL = "Claude Code";
export const DEFAULT_FORMAT = "[{project}] {label}";
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// Replace C0 controls, DEL, and C1 controls (0x80-0x9f) with spaces, then
// collapse runs. Control chars must never reach the OSC sequence — a stray ESC
// or BEL corrupts it, and C1 ST (0x9c) can terminate it early on 8-bit terminals.
function clean(s) {
  let out = "";
  for (const ch of s ?? "") {
    const n = ch.codePointAt(0);
    out += n < 0x20 || (n >= 0x7f && n <= 0x9f) ? " " : ch;
  }
  return out.replace(/ +/g, " ").trim();
}

// Substitute {project}/{label} into the template; unknown {tokens} and all other
// literal text are kept verbatim. The fully assembled title (template literals
// included) is run through clean(), so a control char in a config template can't
// break the OSC sequence any more than one in a value can. Truncate by code
// point: a single-code-point glyph is never split, though a multi-code-point
// grapheme in label text still can be.
export function renderTitle(format, { project, label }) {
  const values = { project: clean(project), label: clean(label) };
  const title = clean(
    (format ?? DEFAULT_FORMAT).replace(/\{(project|label)\}/g, (_, key) => values[key]),
  );
  const cp = [...title];
  if (cp.length > MAX_LEN) return cp.slice(0, MAX_LEN - 1).join("").trimEnd() + "…";
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

// claude-mem stamps each summary with the memory_session_id of the generation
// run that wrote it, and sdk_sessions maps the window's content_session_id to
// its *current* memory_session_id. That mapping rotates between generation runs
// without cascading to old rows, so only recent summaries resolve through it;
// older ones are orphaned (their memory id is on no session row).
//
// Attribution, latest match wins:
//   1. A summary stamped with this window's current memory id is this window's.
//   2. A summary stamped with another window's current memory id is never ours.
//   3. An orphaned summary is correlated by time, but only via a matching
//      prompt ordinal: it belongs to the window whose prompt with the summary's
//      own prompt_number most recently preceded it. An orphan without a
//      prompt_number anchors nothing and is never attributed. The anchor keeps
//      a window that merely prompts during another window's generation lag
//      from stealing the summary.
export function latestRequestForSession(db, project, sessionId) {
  if (!project || !sessionId) return null;
  const row = db
    .query(
      `SELECT s.request
       FROM session_summaries s
       WHERE s.project = $project
         AND s.request IS NOT NULL AND s.request != ''
         AND (
           s.memory_session_id = (SELECT memory_session_id FROM sdk_sessions
                                  WHERE content_session_id = $session LIMIT 1)
           OR (
             NOT EXISTS (SELECT 1 FROM sdk_sessions own
                         WHERE own.memory_session_id = s.memory_session_id)
             AND (
               SELECT up.content_session_id
               FROM user_prompts up
               JOIN sdk_sessions sk ON sk.content_session_id = up.content_session_id
               WHERE sk.project = $project
                 AND up.created_at_epoch <= s.created_at_epoch
                 AND up.prompt_number = s.prompt_number
               ORDER BY up.created_at_epoch DESC, (up.content_session_id = $session) DESC, up.rowid DESC
               LIMIT 1
             ) = $session
           )
         )
       ORDER BY s.created_at_epoch DESC
       LIMIT 1`,
    )
    .get({ $project: project, $session: sessionId });
  return row?.request ?? null;
}

// The session's opening prompt — a usable task label for a window that owns no
// summary yet (claude-mem fills summaries in with generation lag).
export function firstPromptForSession(db, sessionId) {
  if (!sessionId) return null;
  const row = db
    .query("SELECT user_prompt FROM sdk_sessions WHERE content_session_id = ? LIMIT 1")
    .get(sessionId);
  return row?.user_prompt || null;
}

// Label preference: attributable summary, then the window's own first prompt,
// then the default. Returns null only when no project can be determined at all.
// `format` defaults to DEFAULT_FORMAT.
export function resolveTitle(db, { sessionId, cwd, format }) {
  const project = projectForSession(db, sessionId, cwd);
  if (!project) return null;
  const request = latestRequestForSession(db, project, sessionId);
  const label = request || firstPromptForSession(db, sessionId) || DEFAULT_LABEL;
  return renderTitle(format, { project, label });
}
