import { test, expect } from "bun:test";
import { configureSettings } from "../hooks/configure-settings.mjs";

const MARKER_ARG = "--installed-by=claude-mem-terminal-title";
const DISABLE = "CLAUDE_CODE_DISABLE_TERMINAL_TITLE";
const MANAGED = "CMTT_MANAGED_DISABLE_TITLE";

const cmd = (path = "/tools/cmtt/hooks/stop.mjs") =>
  `"/bun" "${path}" ${MARKER_ARG}`;

const opts = (action, command = cmd()) => ({
  action,
  command,
  marker: MARKER_ARG,
  disableEnv: DISABLE,
  managedEnv: MANAGED,
});

const stopCommands = (s) =>
  (s.hooks?.Stop ?? []).flatMap((g) => g.hooks.map((h) => h.command));

test("install adds the Stop hook and the disable + managed env vars", () => {
  const s = configureSettings({}, opts("install"));
  expect(stopCommands(s)).toEqual([cmd()]);
  expect(s.env[DISABLE]).toBe("1");
  expect(s.env[MANAGED]).toBe("1");
});

test("install is idempotent even when the install path changes (rename-safe)", () => {
  let s = configureSettings({}, opts("install", cmd("/a/hooks/stop.mjs")));
  s = configureSettings(s, opts("install", cmd("/totally/different/hooks/stop.mjs")));
  // Marker is the arg, not the path, so the prior entry is replaced, not duplicated.
  expect(s.hooks.Stop.length).toBe(1);
  expect(stopCommands(s)).toEqual([cmd("/totally/different/hooks/stop.mjs")]);
});

test("install preserves unrelated Stop hooks", () => {
  const foreign = { hooks: [{ type: "command", command: "echo other" }] };
  const s = configureSettings({ hooks: { Stop: [foreign] } }, opts("install"));
  expect(s.hooks.Stop).toContainEqual(foreign);
  expect(s.hooks.Stop.length).toBe(2);
});

test("uninstall removes our hook and env vars, preserving foreign hooks", () => {
  const foreign = { hooks: [{ type: "command", command: "echo other" }] };
  let s = configureSettings({ hooks: { Stop: [foreign] } }, opts("install"));
  s = configureSettings(s, opts("uninstall"));
  expect(s.hooks.Stop).toEqual([foreign]);
  expect(s.env?.[DISABLE]).toBeUndefined();
  expect(s.env?.[MANAGED]).toBeUndefined();
});

test("install then uninstall round-trips an empty settings object back to empty", () => {
  let s = configureSettings({}, opts("install"));
  s = configureSettings(s, opts("uninstall"));
  expect(s).toEqual({});
});

test("uninstall leaves a user-set disable env var untouched", () => {
  // User set the env var themselves before ever installing.
  let s = { env: { [DISABLE]: "1", FOO: "bar" } };
  s = configureSettings(s, opts("install")); // must not claim it
  expect(s.env[MANAGED]).toBeUndefined();
  s = configureSettings(s, opts("uninstall"));
  expect(s.env[DISABLE]).toBe("1"); // still there
  expect(s.env.FOO).toBe("bar");
});

test("a foreign hook that merely mentions the tool name is not claimed", () => {
  // Matching is on the full --installed-by arg, not the bare name, so an
  // unrelated hook whose command contains the name (e.g. a fork's path) survives.
  const foreign = {
    hooks: [{ type: "command", command: '"/bun" "/home/u/claude-mem-terminal-title-fork/x.mjs"' }],
  };
  let s = configureSettings({ hooks: { Stop: [foreign] } }, opts("install"));
  expect(s.hooks.Stop).toContainEqual(foreign);
  s = configureSettings(s, opts("uninstall"));
  expect(s.hooks.Stop).toEqual([foreign]);
});

test("a pre-marker install's disable env is left in place on uninstall (conservative)", () => {
  // Migration tail: a value set without the managed marker is never auto-removed,
  // so the tool never deletes a value it can't prove it owns.
  let s = { env: { [DISABLE]: "1" } };
  s = configureSettings(s, opts("uninstall"));
  expect(s.env[DISABLE]).toBe("1");
});

test("unknown action throws", () => {
  expect(() => configureSettings({}, opts("bogus"))).toThrow();
});
