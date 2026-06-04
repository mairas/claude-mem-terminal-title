#!/usr/bin/env bun
// Install or remove the Stop hook in Claude Code's settings.json. Idempotent:
// install first strips any prior entry for this tool, then adds a fresh one.
//
//   bun configure.mjs install
//   bun configure.mjs uninstall

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MARKER = "claude-mem-terminal-title";
// Claude Code animates the terminal title itself, overwriting any title a hook
// sets. This env var disables CC's title management so the hook can own it.
const DISABLE_TITLE_ENV = "CLAUDE_CODE_DISABLE_TERMINAL_TITLE";
const action = process.argv[2];

const settingsPath = join(
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  "settings.json",
);
const bun = process.execPath;
const script = join(import.meta.dir, "stop.mjs");
const command = `"${bun}" "${script}"`;

function load() {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8") || "{}");
}

function isOurs(group) {
  return JSON.stringify(group).includes(MARKER);
}

const settings = load();
settings.hooks ??= {};
const stop = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];
const others = stop.filter((g) => !isOurs(g));

if (action === "install") {
  others.push({
    hooks: [{ type: "command", command, timeout: 10 }],
  });
  settings.hooks.Stop = others;
  settings.env ??= {};
  settings.env[DISABLE_TITLE_ENV] = "1";
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`Installed Stop hook in ${settingsPath}`);
  console.log(`  ${command}`);
  console.log(`Set env ${DISABLE_TITLE_ENV}=1 (disables CC's own title animation)`);
  console.log("Restart Claude Code (or start a new session) for the env var to take effect.");
} else if (action === "uninstall") {
  if (others.length) settings.hooks.Stop = others;
  else delete settings.hooks.Stop;
  if (settings.env?.[DISABLE_TITLE_ENV] !== undefined) delete settings.env[DISABLE_TITLE_ENV];
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`Removed Stop hook and ${DISABLE_TITLE_ENV} from ${settingsPath}`);
} else {
  console.error("usage: configure.mjs install|uninstall");
  process.exit(1);
}
