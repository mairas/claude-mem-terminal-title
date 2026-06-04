// Pure title-resolution logic. Operates on an already-opened bun:sqlite
// Database so it can be unit-tested against an in-memory fixture.

const MAX_LEN = 100;
const DEFAULT_LABEL = "Claude Code";
export const DEFAULT_FORMAT = "{emoji} [{project}] {label}";
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// A window keeps the same emoji for its whole life so it's recognisable at a
// glance. Every entry is a single code point (no ZWJ, flag, or variation-
// selector sequences) so codepoint-safe truncation can never split one, and
// they're visually distinct from each other.
export const EMOJI_PALETTE = [
  "🦊", "🐱", "🐶", "🐺", "🦁", "🐯", "🐮", "🐷", "🐸", "🐵",
  "🐔", "🐧", "🦉", "🦄", "🐙", "🦋", "🐝", "🐞", "🦀", "🐠",
  "🐬", "🐳", "🐢", "🦎", "🦖", "🦕", "🐌", "🦅", "🦜", "🦩",
  "🌵", "🌲", "🌻", "🌹", "🍀", "🍄", "🍎", "🍊", "🍋", "🍇",
  "🍓", "🍒", "🥑", "🌮", "🍕", "🎸", "🎺", "🎯", "🎲", "🚀",
];

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

// Deterministic per-window emoji: FNV-1a over the session id picks a palette
// entry, so the same window always shows the same emoji. Pseudo-unique, not
// coordinated — two windows can collide, but rarely with this palette size.
// No session id yet (cwd-fallback window) → empty string, and {emoji} collapses.
export function emojiForSession(sessionId) {
  if (!sessionId) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return EMOJI_PALETTE[(h >>> 0) % EMOJI_PALETTE.length];
}

// Substitute {emoji}/{project}/{label} into the template, leaving any unknown
// {token} literal. The fully assembled title — template literals included — is
// run through clean(), so a control char in a config template can't break the
// OSC sequence any more than one in a value can. Truncate by code point so a
// palette emoji (always a single code point) is never split; arbitrary
// multi-code-point graphemes in label text can still be cut.
export function renderTitle(format, { emoji, project, label }) {
  const values = { emoji: emoji ?? "", project: clean(project), label: clean(label) };
  const title = clean(
    (format ?? DEFAULT_FORMAT).replace(/\{(emoji|project|label)\}/g, (_, key) => values[key]),
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

// claude-mem doesn't stamp the originating session onto a summary, so two windows
// on one project can't be told apart by a direct key. Correlate by time instead:
// a summary belongs to whichever of the project's windows prompted most recently
// before that summary was generated. user_prompts carries a reliable
// (content_session_id, created_at_epoch) timeline per window.
export function latestRequestForSession(db, project, sessionId) {
  if (!project || !sessionId) return null;
  const row = db
    .query(
      `SELECT s.request
       FROM session_summaries s
       WHERE s.project = $project
         AND s.request IS NOT NULL AND s.request != ''
         AND (
           SELECT up.content_session_id
           FROM user_prompts up
           JOIN sdk_sessions sk ON sk.content_session_id = up.content_session_id
           WHERE sk.project = $project AND up.created_at_epoch <= s.created_at_epoch
           ORDER BY up.created_at_epoch DESC, (up.content_session_id = $session) DESC, up.rowid DESC
           LIMIT 1
         ) = $session
       ORDER BY s.created_at_epoch DESC
       LIMIT 1`,
    )
    .get({ $project: project, $session: sessionId });
  return row?.request ?? null;
}

// Falls back to the default label when the window owns no summary yet (a fresh
// window, or a project with no claude-mem history). Returns null only when no
// project can be determined at all. `format` defaults to DEFAULT_FORMAT.
export function resolveTitle(db, { sessionId, cwd, format }) {
  const project = projectForSession(db, sessionId, cwd);
  if (!project) return null;
  const request = latestRequestForSession(db, project, sessionId);
  return renderTitle(format, {
    emoji: emojiForSession(sessionId),
    project,
    label: request || DEFAULT_LABEL,
  });
}
