import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  commitCommand,
  buildBoundedCommitPrompt,
  OVERSIZED_PREFIX,
} from "../src/commands/commit.js";
import { fitsInGeminiRequest } from "../src/lib/provider.js";
import { CredentialStoreUnavailableError, setCredentialBackend } from "../src/lib/credentials.js";
import { setConfigDir, recordNoticeAcceptance } from "../src/lib/config.js";

test("buildBoundedCommitPrompt switches to bounded summary for multi-byte UTF-8 and newline-heavy diffs", async () => {
  // 1. Multi-byte UTF-8 diff under 800k chars (400k chars = 1.2 MB UTF-8)
  const multiByteDiff = "€".repeat(400_000);
  let summaryCalled = 0;
  const prompt1 = await buildBoundedCommitPrompt({
    intent: "update pricing",
    diff: multiByteDiff,
    getSummary: async () => {
      summaryCalled++;
      return "M\tpricing.txt";
    },
  });
  assert.equal(summaryCalled, 1);
  assert.ok(prompt1.includes(OVERSIZED_PREFIX));
  assert.equal(fitsInGeminiRequest(prompt1), true);

  // 2. Newline-heavy diff under 800k chars (600k chars -> > 1.2 MB JSON-escaped)
  const newlineDiff = "\n".repeat(600_000);
  const prompt2 = await buildBoundedCommitPrompt({
    intent: "format",
    diff: newlineDiff,
    getSummary: async () => {
      summaryCalled++;
      return "M\tformat.txt";
    },
  });
  assert.equal(summaryCalled, 2);
  assert.equal(fitsInGeminiRequest(prompt2), true);

  // 3. Huge summary itself is bounded so the final prompt still fits in Gemini's request byte limit
  const hugeSummary = Array.from(
    { length: 20_000 },
    (_, i) => `M\tpackages/module-${i}/src/index.js`
  ).join("\n");
  const prompt3 = await buildBoundedCommitPrompt({
    intent: "massive refactor",
    diff: multiByteDiff,
    getSummary: async () => hugeSummary,
  });
  assert.equal(fitsInGeminiRequest(prompt3), true);
  assert.match(prompt3, /\[file summary truncated due to size\]/);
});

test("commitCommand --dry-run writes only the exact message to stdout byte-for-byte", async () => {
  const stdoutChunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);

  const fakeGit = {
    isInsideGitRepo: async () => true,
    getGitRepoState: async () => ["rebase"], // triggers a warning that must go to stderr, not stdout
    getStagedFiles: async () => ["src/auth.js"],
    getStagedDiff: async () => "+export const login = true;\n",
    getStagedSummary: async () => "M\tsrc/auth.js",
    getStagedTreeHash: async () => "tree-hash-1",
    commit: async () => {
      throw new Error("commit must not be called in dry-run mode");
    },
  };

  process.stdout.write = (chunk, encoding, cb) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString(encoding || "utf8"));
    if (typeof encoding === "function") encoding();
    else if (typeof cb === "function") cb();
    return true;
  };

  try {
    await commitCommand(
      "add login",
      { dryRun: true },
      {
        git: fakeGit,
        ensureReady: async () => ({
          config: { provider: "gemini", model: "gemini-2.5-flash" },
          keyInfo: { key: "fake-key", source: "env" },
        }),
        createProvider: () => ({
          generate: async () => "feat(auth): add login\n\n- enable login flag",
        }),
      }
    );
  } finally {
    process.stdout.write = origWrite;
  }

  const fullStdout = stdoutChunks.join("");
  assert.equal(fullStdout, "feat(auth): add login\n\n- enable login flag\n");
});

test("commitCommand refuses to commit when staged index mutates before commit execution", async () => {
  let currentTreeHash = "initial-tree-111";
  let commitCalled = false;
  let exitCode = null;
  const origExit = process.exit;

  const fakeGit = {
    isInsideGitRepo: async () => true,
    getGitRepoState: async () => [],
    getStagedFiles: async () => ["a.js"],
    getStagedDiff: async () => "+const a = 1;\n",
    getStagedSummary: async () => "M\ta.js",
    getStagedTreeHash: async () => currentTreeHash,
    commit: async () => {
      commitCalled = true;
    },
  };

  process.exit = (code) => {
    exitCode = code;
    throw new Error(`PROCESS_EXIT_${code}`);
  };

  try {
    await assert.rejects(async () => {
      await commitCommand(
        "update a",
        {},
        {
          allowNonTty: true,
          git: fakeGit,
          ensureReady: async () => ({
            config: { provider: "gemini", model: "gemini-2.5-flash" },
            keyInfo: { key: "fake-key", source: "env" },
          }),
          createProvider: () => ({
            generate: async () => "feat: update a",
          }),
          chooseAction: async () => "accept",
          beforeSnapshotRecheck: async () => {
            // Simulate another process modifying `.git/index` right before the re-check
            currentTreeHash = "mutated-tree-222";
          },
        }
      );
    }, /PROCESS_EXIT_1/);

    assert.equal(exitCode, 1);
    assert.equal(commitCalled, false);
  } finally {
    process.exit = origExit;
  }
});

test("commitCommand catches CredentialStoreUnavailableError via centralized handleError", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-cred-err-test-"));
  setConfigDir(tmpDir);
  recordNoticeAcceptance();

  const oldEnvKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const unavailableBackend = {
    platform: "linux",
    isAvailable: async () => ({
      available: false,
      reason: "Secret Service daemon is not running",
    }),
    getPassword: async () => {
      throw new CredentialStoreUnavailableError("Secret Service daemon is not running", "linux");
    },
  };
  setCredentialBackend(unavailableBackend);

  let exitCode = null;
  const origExit = process.exit;
  process.exit = (code) => {
    exitCode = code;
    throw new Error(`HANDLED_EXIT_${code}`);
  };

  const fakeGit = {
    isInsideGitRepo: async () => true,
    getGitRepoState: async () => [],
    getStagedFiles: async () => ["a.js"],
    getStagedDiff: async () => "+const a = 1;\n",
    getStagedSummary: async () => "M\ta.js",
    getStagedTreeHash: async () => "tree-1",
  };

  try {
    await assert.rejects(async () => {
      await commitCommand("test", {}, { allowNonTty: true, git: fakeGit });
    }, /HANDLED_EXIT_1/);
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
    if (oldEnvKey !== undefined) process.env.GEMINI_API_KEY = oldEnvKey;
    setConfigDir(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("commitCommand --dry-run with a fresh config and environment key fails early without prompting unless explicit consent is passed", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-dryrun-fresh-"));
  setConfigDir(tmpDir);

  const oldEnvKey = process.env.GEMINI_API_KEY;
  const oldAcceptEnv = process.env.GIT_PILOT_ACCEPT_NOTICE;
  process.env.GEMINI_API_KEY = "AIzaSyFreshDryRunEnvKey1234567890";
  delete process.env.GIT_PILOT_ACCEPT_NOTICE;

  const stdoutChunks = [];
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origExit = process.exit;
  let exitCode = null;

  const fakeGit = {
    isInsideGitRepo: async () => true,
    getGitRepoState: async () => [],
    getStagedFiles: async () => ["src/app.js"],
    getStagedDiff: async () => "+const x = 1;\n",
    getStagedSummary: async () => "M\tsrc/app.js",
    getStagedTreeHash: async () => "tree-fresh",
  };

  process.stdout.write = (chunk, encoding, cb) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString(encoding || "utf8"));
    if (typeof encoding === "function") encoding();
    else if (typeof cb === "function") cb();
    return true;
  };
  process.exit = (code) => {
    exitCode = code;
    throw new Error(`DRYRUN_EXIT_${code}`);
  };

  try {
    // 1. Fresh config + env key + --dry-run (no consent) -> must fail early with exit code 1, no prompt, clean stdout
    await assert.rejects(async () => {
      await commitCommand(
        "add x",
        { dryRun: true },
        {
          git: fakeGit,
          createProvider: () => ({
            generate: async () => "feat: add x",
          }),
        }
      );
    }, /DRYRUN_EXIT_1/);

    assert.equal(exitCode, 1);
    assert.equal(stdoutChunks.join(""), "");

    // 2. Fresh config + env key + --dry-run + --accept-notice -> succeeds non-interactively with clean stdout
    exitCode = null;
    await commitCommand(
      "add x",
      { dryRun: true, acceptNotice: true },
      {
        git: fakeGit,
        createProvider: () => ({
          generate: async () => "feat: add x",
        }),
      }
    );
    assert.equal(exitCode, null);
    assert.equal(stdoutChunks.join(""), "feat: add x\n");
  } finally {
    process.stdout.write = origStdoutWrite;
    process.exit = origExit;
    if (oldEnvKey !== undefined) process.env.GEMINI_API_KEY = oldEnvKey;
    else delete process.env.GEMINI_API_KEY;
    if (oldAcceptEnv !== undefined) process.env.GIT_PILOT_ACCEPT_NOTICE = oldAcceptEnv;
    else delete process.env.GIT_PILOT_ACCEPT_NOTICE;
    setConfigDir(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
