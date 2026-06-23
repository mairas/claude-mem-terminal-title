import { execFileSync } from "node:child_process";

// Parse `ps -axo pid= ppid= tty=` output into pid -> { ppid, tty }. A process
// with no controlling terminal shows tty `??`.
export function parsePsSnapshot(text) {
  const map = new Map();
  for (const line of (text ?? "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)?/);
    if (!m) continue;
    map.set(Number(m[1]), { ppid: Number(m[2]), tty: m[3] || "??" });
  }
  return map;
}

// Walk ancestors from startPid and return the first real terminal device
// (/dev/ttysNNN), or null. The Stop hook itself has no controlling terminal —
// Claude Code spawns it with piped stdio — but its Claude Code ancestor is
// attached to the window's pty, so the ancestor walk finds it. Walking *our own*
// chain (rather than picking among all `claude` processes) is what makes this
// land on the right window when several are open.
export function walkToTty(snapshot, startPid) {
  let pid = startPid;
  for (let i = 0; i < 40 && pid > 1; i++) {
    const node = snapshot.get(pid);
    if (!node) break;
    // macOS pty names are `ttysNNN`; Linux are `pts/N`. Both map to /dev/<name>.
    if (/^(ttys\d+|pts\/\d+)$/.test(node.tty)) return "/dev/" + node.tty;
    pid = node.ppid;
  }
  return null;
}

// Resolve the controlling terminal device for the window this process belongs to.
// Returns null on any failure (the caller then relies on the synchronous
// terminalSequence emit instead of an out-of-band write).
export function resolveTerminalDevice(startPid = process.pid) {
  try {
    const out = execFileSync("ps", ["-axo", "pid=,ppid=,tty="], { encoding: "utf8" });
    return walkToTty(parsePsSnapshot(out), startPid);
  } catch {
    return null;
  }
}
