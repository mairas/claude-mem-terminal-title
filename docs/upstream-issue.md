# Upstream issue draft: thedotmack/claude-mem

Draft of a feature request for [claude-mem](https://github.com/thedotmack/claude-mem).
Not yet filed. This is the exact fix that makes per-window terminal titling reliable
(see the repository README, "Telling same-repo windows apart"). Confirmed against
claude-mem v13.4.0.

---

**Title:** Stamp originating `content_session_id` onto generated `session_summaries` and `observations` rows at write time

## Problem

A consumer holding a Claude Code `session_id` (what a hook receives as
`content_session_id`) cannot reliably map it to that session's freshly generated
`session_summaries` / `observations` rows.

Neither `observations` nor `session_summaries` carries `content_session_id`. Both
reference only `sdk_sessions(memory_session_id)` (see `src/services/sqlite/schema.sql`,
the `observations` and `session_summaries` table definitions and their
`FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id)`). The only
path back to a Claude Code session is
`observations/summaries → sdk_sessions.memory_session_id → sdk_sessions.content_session_id`,
and that path is unreliable for recent rows:

- A single Claude Code session fans out into multiple ephemeral SDK
  `memory_session_id`s over its lifetime (the observer respawns SDK sessions).
- `sdk_sessions.memory_session_id` is `UNIQUE`, and `ensureMemorySessionIdRegistered`
  (`src/services/sqlite/SessionStore.ts:1029`) overwrites it per `sessionDbId` on each
  storage round. So the freshest generated rows routinely have a `memory_session_id`
  that has no settled `sdk_sessions` row mapping it back to a `content_session_id`.
- Result: `LEFT JOIN sdk_sessions ON memory_session_id` returns `NULL`
  `content_session_id` for the most recent rows — exactly when a consumer wants them.

## Repro

1. Run a Claude Code session that generates memory.
2. Immediately query the newest generated rows joined to the session map:
   ```sql
   SELECT s.id, s.request, sk.content_session_id
   FROM session_summaries s
   LEFT JOIN sdk_sessions sk ON s.memory_session_id = sk.memory_session_id
   ORDER BY s.created_at_epoch DESC LIMIT 5;
   ```
3. `content_session_id` is `NULL` for the freshest rows; the originating Claude Code
   session is unrecoverable at the moment a consumer would map it.

The data exists internally at generation time — it just isn't propagated onto the row.

## Proposed change

Stamp the originating `content_session_id` (and ideally the transcript path) directly
onto each generated `session_summaries` and `observations` row at write time, instead
of relying on the lagging `sdk_sessions` join.

`content_session_id` is already in scope at the single storage call site. In
`processAgentResponse` (`src/services/worker/agents/ResponseProcessor.ts`),
`session.contentSessionId` is read repeatedly right where storage happens — it is
passed to commit verification (line ~123), the observation/summary broadcasts
(`session_id: session.contentSessionId`, lines ~328/409), and chroma sync — but it is
not passed to `sessionStore.storeObservations(...)` (line ~152) or into the summary
store. `ActiveSession.contentSessionId` is non-nullable (`src/services/worker-types.ts:11`),
so it is always available here.

Concretely:

- Add a `content_session_id` column to `observations` and `session_summaries`
  (`src/services/sqlite/schema.sql` + a migration).
- Thread `session.contentSessionId` from `processAgentResponse` through
  `SessionStore.storeObservations` (`src/services/sqlite/SessionStore.ts:1867`) into
  `storeObservation` (`src/services/sqlite/observations/store.ts`) and `storeSummary`
  (`src/services/sqlite/summaries/store.ts`), persisting it in the `INSERT`.
- Optionally do the same for the transcript path / cwd (cwd is already carried on
  `PendingMessage.cwd` and `projectRoot` flows into `processAgentResponse`).

This lets a consumer map memory back to a specific Claude Code session/window directly
off the row, with no dependency on `sdk_sessions` having settled. It enables use cases
such as per-window terminal-title updates, where two windows on the same project/cwd
must be told apart.

## Why #2671 doesn't cover this

PR #2671 ("carry session folder onto generated observation metadata") stamps the
session's **project/folder** — derived from cwd basename — onto generated
observation/summary metadata. That is a project-level dimension, not a per-window
identifier: two Claude Code windows open on the same project/cwd share the same folder
label and remain indistinguishable. Mapping back to the specific originating session
requires `content_session_id`, which #2671 does not add.

## Change sites

- `src/services/worker/agents/ResponseProcessor.ts` — `processAgentResponse`: storage
  call site; `session.contentSessionId` in scope but not passed to the stores.
- `src/services/sqlite/SessionStore.ts` — `storeObservations` (line 1867) and the
  summary store wrapper; the threading point.
- `src/services/sqlite/observations/store.ts` — `storeObservation`: observation `INSERT`.
- `src/services/sqlite/summaries/store.ts` — `storeSummary`: summary `INSERT`.
- `src/services/sqlite/schema.sql` — `observations` / `session_summaries` definitions
  (plus a migration under `src/services/sqlite/migrations/`).
- Context: `ensureMemorySessionIdRegistered` at `SessionStore.ts:1029` (the
  `UNIQUE memory_session_id` overwrite that makes the join lag); `ActiveSession.contentSessionId`
  at `worker-types.ts:11`.
