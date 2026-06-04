#!/usr/bin/env bun
// Runs the real resolver queries against the live claude-mem DB so a schema
// drift (renamed table/column) surfaces as a clear error instead of the hook
// silently no-opping.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveTitle } from "./resolve-title.mjs";

const DB = process.env.CMTT_DB || join(homedir(), ".claude-mem", "claude-mem.db");

if (!existsSync(DB)) {
  console.error(`claude-mem DB not found at ${DB}`);
  process.exit(1);
}

const { Database } = await import("bun:sqlite");
try {
  const db = new Database(DB, { readonly: true });
  const title = resolveTitle(db, { sessionId: "cmtt-doctor", cwd: process.cwd() });
  db.close();
  console.log(`OK — claude-mem schema matches the resolver queries.`);
  console.log(`Resolved title for ${process.cwd()}: ${JSON.stringify(title)}`);
} catch (e) {
  console.error("SCHEMA MISMATCH or query error:", e?.message || String(e));
  console.error("claude-mem's schema may have changed; the resolver queries need updating.");
  process.exit(1);
}
