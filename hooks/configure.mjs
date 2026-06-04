#!/usr/bin/env bun
// Install or remove the Stop hook in Claude Code's settings.json. Idempotent:
// install first strips any prior entry for this tool, then adds a fresh one.
//
//   bun configure.mjs install
//   bun configure.mjs uninstall

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configureSettings } from "./configure-settings.mjs";

const MARKER = "claude-mem-terminal-title";
// Claude Code animates the terminal title itself, overwriting any title a hook
// sets. This env var disables CC's title management so the hook can own it.
const DISABLE_TITLE_ENV = "CLAUDE_CODE_DISABLE_TERMINAL_TITLE";
const MANAGED_ENV = "CMTT_MANAGED_DISABLE_TITLE";
const action = process.argv[2];

const settingsPath = join(
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  "settings.json",
);
const bun = process.execPath;
const script = join(import.meta.dir, "stop.mjs");
// The trailing marker arg (ignored by stop.mjs) makes ownership detection
// independent of the install directory's name. Match on the full arg, not the
// bare name, so an unrelated hook that merely mentions the name isn't claimed.
const MARKER_ARG = `--installed-by=${MARKER}`;
const command = `"${bun}" "${script}" ${MARKER_ARG}`;

if (action !== "install" && action !== "uninstall") {
  console.error("usage: configure.mjs install|uninstall");
  process.exit(1);
}

const settings = existsSync(settingsPath)
  ? JSON.parse(readFileSync(settingsPath, "utf8") || "{}")
  : {};

configureSettings(settings, {
  action,
  command,
  marker: MARKER_ARG,
  disableEnv: DISABLE_TITLE_ENV,
  managedEnv: MANAGED_ENV,
});

mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

if (action === "install") {
  console.log(`Installed Stop hook in ${settingsPath}`);
  console.log(`  ${command}`);
  console.log(`Set env ${DISABLE_TITLE_ENV}=1 (disables CC's own title animation)`);
  console.log("Restart Claude Code (or start a new session) for the env var to take effect.");
} else {
  console.log(`Removed Stop hook from ${settingsPath}`);
}
