import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

const git = async (args) => (await execa("git", args)).stdout;

export const getStagedDiff = () => git(["diff", "--staged"]);
export const getStagedSummary = () => git(["diff", "--staged", "--name-status"]);
export const getReflog = () => git(["reflog", "-n", "15"]);
export const commit = (message) => git(["commit", "-m", message]);
export const createBranch = (name) => git(["switch", "-c", name]);

const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false
  );

export async function isRebaseInProgress() {
  const gitDir = path.resolve(await git(["rev-parse", "--git-dir"]));
  return (
    (await exists(path.join(gitDir, "rebase-apply"))) ||
    (await exists(path.join(gitDir, "rebase-merge")))
  );
}

/** Lowercase, hyphenated, git-safe branch name; "" if nothing usable is left. */
export const slugifyBranchName = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._\-/]/g, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^-+|-+$/g, "")
    .slice(0, 250);
