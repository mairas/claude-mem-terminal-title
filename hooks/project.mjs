import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";

// Project name = basename of the git work-tree root containing cwd, falling back
// to the cwd basename. Walks up looking for a `.git` entry (a directory in a
// normal clone, a file in a worktree/submodule). This reproduces how the title
// was named before — the repo name, not a nested subdirectory — without needing
// claude-mem's database.
export function projectForCwd(cwd) {
  if (!cwd) return null;
  let dir = String(cwd).replace(/\/+$/, "");
  for (let i = 0; i < 50 && dir && dir !== "/"; i++) {
    if (existsSync(join(dir, ".git"))) return basename(dir) || null;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return basename(String(cwd).replace(/\/+$/, "")) || null;
}
