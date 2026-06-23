import { test, expect } from "bun:test";
import { parsePsSnapshot, walkToTty } from "../hooks/terminal.mjs";

// Modeled on real `ps -axo pid=,ppid=,tty=` output: the hook (pipe stdio, no
// tty) under a shell, under the claude process which holds the pty.
const SNAPSHOT = `
  900   850 ??
  850   700 ??
  700   500 ttys002
  500     1 ttys002
   42    41 ??
`;

test("parsePsSnapshot maps pid -> {ppid, tty}", () => {
  const m = parsePsSnapshot(SNAPSHOT);
  expect(m.get(900)).toEqual({ ppid: 850, tty: "??" });
  expect(m.get(700)).toEqual({ ppid: 500, tty: "ttys002" });
});

test("walkToTty finds the first ancestor with a real pty", () => {
  const m = parsePsSnapshot(SNAPSHOT);
  expect(walkToTty(m, 900)).toBe("/dev/ttys002");
});

test("walkToTty returns the device directly when the start process has a tty", () => {
  const m = parsePsSnapshot(SNAPSHOT);
  expect(walkToTty(m, 700)).toBe("/dev/ttys002");
});

test("walkToTty resolves a Linux pts device", () => {
  const m = parsePsSnapshot("900 850 ??\n850 700 pts/3\n700 1 pts/3");
  expect(walkToTty(m, 900)).toBe("/dev/pts/3");
});

test("walkToTty returns null when no ancestor has a pty", () => {
  const m = parsePsSnapshot("42 41 ??\n41 1 ??");
  expect(walkToTty(m, 42)).toBeNull();
});

test("walkToTty stops cleanly when the chain leaves the snapshot", () => {
  const m = parsePsSnapshot("900 850 ??");
  expect(walkToTty(m, 900)).toBeNull();
});

test("walkToTty does not loop forever on a cyclic chain", () => {
  const m = new Map([
    [1, { ppid: 2, tty: "??" }],
    [2, { ppid: 1, tty: "??" }],
  ]);
  expect(walkToTty(m, 2)).toBeNull();
});
