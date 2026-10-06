import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { sanitizeTerminalText } from "./sanitizer.js";
import { redactSecretText } from "./credentials.js";

const SECRET_ENV_PATTERN =
  /^(GEMINI|GOOGLE|OPENAI|ANTHROPIC|CLAUDE|COHERE|MISTRAL|GIT_PILOT)_.*(KEY|TOKEN|SECRET)|_API_KEY$/i;

/**
 * Builds a clean environment for Git subprocesses and hooks.
 * Strips GEMINI_API_KEY and other provider credentials so Git hooks or helpers
 * never inherit API keys, while preserving standard Git and system variables.
 */
export function getSanitizedGitEnv(baseEnv = process.env) {
  const clean = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (SECRET_ENV_PATTERN.test(key)) continue;
    if (key === "GIT_EXTERNAL_DIFF") continue;
    clean[key] = value;
  }
  clean.GIT_PAGER = "cat";
  return clean;
}

const git = async (args, opts = {}) =>
  (
    await execa("git", args, {
      env: getSanitizedGitEnv(),
      extendEnv: false,
      ...opts,
    })
  ).stdout;

export class GitCommitError extends Error {
  constructor(message, originalError, commitMessage) {
    super(message);
    this.name = "GitCommitError";
    this.originalError = originalError;
    this.commitMessage = commitMessage;
    this.exitCode = originalError?.exitCode;
  }
}

export async function isInsideGitRepo() {
  try {
    const res = await git(["rev-parse", "--is-inside-work-tree"]);
    return res.trim() === "true";
  } catch {
    return false;
  }
}

export const getStagedDiff = () => git(["diff", "--staged", "--no-ext-diff", "--no-textconv"]);

export const getStagedSummary = () =>
  git(["diff", "--staged", "--name-status", "--no-ext-diff", "--no-textconv"]);

export function parseStagedFileList(output) {
  return output.split("\0").filter((file) => file.length > 0);
}

/**
 * Returns staged file paths using NUL-delimited (`-z`) output so filenames
 * containing leading/trailing spaces, special characters, or newlines remain intact.
 */
export async function getStagedFiles() {
  const output = await git(
    ["diff", "--staged", "--name-only", "-z", "--no-ext-diff", "--no-textconv"],
    { stripFinalNewline: false }
  );
  return parseStagedFileList(output);
}

/**
 * Returns the current staged index tree hash (`git write-tree`).
 * Used for best-effort detection of concurrent index modifications before `git commit`.
 */
export async function getStagedTreeHash() {
  try {
    return (await git(["write-tree"])).trim();
  } catch {
    // Fallback if write-tree cannot run (e.g. unmerged paths)
    return (await getStagedDiff()).trim();
  }
}

export const getReflog = () => git(["reflog", "-n", "15"]);

export async function hasOrigHead() {
  try {
    await git(["rev-parse", "--verify", "--quiet", "ORIG_HEAD^{commit}"]);
    return true;
  } catch {
    return false;
  }
}

export async function commit(message) {
  try {
    return await git(["commit", "-m", message]);
  } catch (err) {
    const rawDetails = (err.stderr || err.stdout || err.message || "").trim();
    const details = sanitizeTerminalText(redactSecretText(rawDetails));
    throw new GitCommitError(`Git commit failed (hooks or git error): ${details}`, err, message);
  }
}

export const createBranch = (name) => git(["switch", "-c", name]);

const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false
  );

export async function getGitRepoState() {
  try {
    const gitDir = path.resolve(await git(["rev-parse", "--git-dir"]));
    const states = [];
    if (
      (await exists(path.join(gitDir, "rebase-apply"))) ||
      (await exists(path.join(gitDir, "rebase-merge")))
    ) {
      states.push("rebase");
    }
    if (await exists(path.join(gitDir, "MERGE_HEAD"))) {
      states.push("merge");
    }
    if (await exists(path.join(gitDir, "CHERRY_PICK_HEAD"))) {
      states.push("cherry-pick");
    }
    if (await exists(path.join(gitDir, "REVERT_HEAD"))) {
      states.push("revert");
    }
    return states;
  } catch {
    return [];
  }
}

export async function isRebaseInProgress() {
  const states = await getGitRepoState();
  return states.includes("rebase");
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
