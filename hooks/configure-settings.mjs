// Pure settings transform for install/uninstall, separated from file I/O so it
// can be unit-tested. Mutates and returns the given settings object.
//
// Ownership tracking: install only sets disableEnv when it is absent, recording
// that it did so via managedEnv. uninstall removes disableEnv only when managedEnv
// is present, so a value the user set themselves is left untouched.

export function configureSettings(
  settings,
  { action, command, marker, disableEnv, managedEnv },
) {
  settings.hooks ??= {};
  const stop = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];
  const others = stop.filter((g) => !JSON.stringify(g).includes(marker));

  if (action === "install") {
    others.push({ hooks: [{ type: "command", command, timeout: 10 }] });
    settings.hooks.Stop = others;
    settings.env ??= {};
    if (settings.env[disableEnv] === undefined) {
      settings.env[disableEnv] = "1";
      settings.env[managedEnv] = "1";
    }
  } else if (action === "uninstall") {
    if (others.length) settings.hooks.Stop = others;
    else delete settings.hooks.Stop;
    if (settings.env?.[managedEnv]) {
      delete settings.env[disableEnv];
      delete settings.env[managedEnv];
    }
    if (settings.env && Object.keys(settings.env).length === 0) delete settings.env;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  } else {
    throw new Error("usage: configure.mjs install|uninstall");
  }
  return settings;
}
