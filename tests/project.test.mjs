import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { projectForCwd } from "../hooks/project.mjs";

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cmtt-proj-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("projectForCwd returns the git-root basename from a nested cwd", () => {
  withTmp((dir) => {
    const repo = join(dir, "myrepo");
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    mkdirSync(join(repo, ".git"));
    expect(projectForCwd(join(repo, "src", "deep"))).toBe("myrepo");
    expect(projectForCwd(repo)).toBe("myrepo");
  });
});

test("projectForCwd treats a .git file (worktree/submodule) as the root", () => {
  withTmp((dir) => {
    const repo = join(dir, "wtrepo");
    mkdirSync(join(repo, "sub"), { recursive: true });
    writeFileSync(join(repo, ".git"), "gitdir: /elsewhere\n");
    expect(projectForCwd(join(repo, "sub"))).toBe("wtrepo");
  });
});

test("projectForCwd falls back to the cwd basename when there is no .git", () => {
  withTmp((dir) => {
    const plain = join(dir, "plaindir");
    mkdirSync(plain);
    expect(projectForCwd(plain)).toBe("plaindir");
  });
});

test("projectForCwd ignores a trailing slash", () => {
  withTmp((dir) => {
    const plain = join(dir, "trailing");
    mkdirSync(plain);
    expect(projectForCwd(plain + "/")).toBe("trailing");
  });
});

test("projectForCwd returns null for empty input", () => {
  expect(projectForCwd("")).toBeNull();
  expect(projectForCwd(undefined)).toBeNull();
});
