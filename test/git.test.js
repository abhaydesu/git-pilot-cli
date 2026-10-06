import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import {
  slugifyBranchName,
  getSanitizedGitEnv,
  getStagedDiff,
  getStagedSummary,
  getStagedFiles,
  parseStagedFileList,
  commit,
} from "../src/lib/git.js";

test("slugifyBranchName", () => {
  assert.equal(slugifyBranchName("Fix Login Bug"), "fix-login-bug");
  assert.equal(slugifyBranchName("  feature/Add  Thing "), "feature/add-thing");
  assert.equal(slugifyBranchName("fix/a//b"), "fix/a/b");
  assert.equal(slugifyBranchName("bad;name$(x)"), "badnamex");
  assert.equal(slugifyBranchName("---"), "");
  assert.equal(slugifyBranchName("x".repeat(400)).length, 250);
});

test("getSanitizedGitEnv strips GEMINI_API_KEY and provider secrets while keeping Git vars", () => {
  const clean = getSanitizedGitEnv({
    PATH: "/usr/bin:/bin",
    HOME: "/Users/test",
    GIT_AUTHOR_NAME: "Alice",
    GEMINI_API_KEY: "AIzaSySuperSecret123",
    GOOGLE_API_KEY: "AIzaSyOtherSecret",
    OPENAI_API_KEY: "sk-secret",
    ANTHROPIC_API_KEY: "sk-ant-secret",
    CUSTOM_API_KEY: "custom-secret",
    GIT_EXTERNAL_DIFF: "/tmp/evil-diff.sh",
  });

  assert.equal(clean.PATH, "/usr/bin:/bin");
  assert.equal(clean.GIT_AUTHOR_NAME, "Alice");
  assert.equal(clean.GIT_PAGER, "cat");
  assert.equal(clean.GEMINI_API_KEY, undefined);
  assert.equal(clean.GOOGLE_API_KEY, undefined);
  assert.equal(clean.OPENAI_API_KEY, undefined);
  assert.equal(clean.ANTHROPIC_API_KEY, undefined);
  assert.equal(clean.CUSTOM_API_KEY, undefined);
  assert.equal(clean.GIT_EXTERNAL_DIFF, undefined);
});

test("git commit hook does not inherit GEMINI_API_KEY from the CLI process", async () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "gp-hook-test-"));
  const oldCwd = process.cwd();
  const oldGeminiKey = process.env.GEMINI_API_KEY;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;

  try {
    process.chdir(tmpRepo);
    await execa("git", ["init", "-q", "-b", "main"]);
    await execa("git", ["config", "user.name", "Test"]);
    await execa("git", ["config", "user.email", "test@example.com"]);

    fs.writeFileSync(path.join(tmpRepo, "file.txt"), "hello\n");
    await execa("git", ["add", "file.txt"]);

    // Install a pre-commit hook that records its entire environment
    const hookDir = path.join(tmpRepo, ".git", "hooks");
    fs.mkdirSync(hookDir, { recursive: true });
    const envDumpFile = path.join(tmpRepo, "hook-env.txt");
    const hookPath = path.join(hookDir, "pre-commit");
    fs.writeFileSync(hookPath, `#!/bin/sh\nenv > "${envDumpFile}"\nexit 0\n`, { mode: 0o755 });
    fs.chmodSync(hookPath, 0o755);

    const secretVal = "AIzaSyHookTestSecretValue9999999999";
    process.env.GEMINI_API_KEY = secretVal;
    process.env.OPENAI_API_KEY = "sk-openai-hook-secret";

    await commit("test: verify hook env isolation");

    assert.equal(fs.existsSync(envDumpFile), true, "Expected pre-commit hook to have executed");
    const dumpedEnv = fs.readFileSync(envDumpFile, "utf8");
    assert.equal(dumpedEnv.includes("GEMINI_API_KEY"), false);
    assert.equal(dumpedEnv.includes("OPENAI_API_KEY"), false);
    assert.equal(dumpedEnv.includes(secretVal), false);
    assert.equal(dumpedEnv.includes("sk-openai-hook-secret"), false);
  } finally {
    process.chdir(oldCwd);
    if (oldGeminiKey !== undefined) process.env.GEMINI_API_KEY = oldGeminiKey;
    else delete process.env.GEMINI_API_KEY;
    if (oldOpenAiKey !== undefined) process.env.OPENAI_API_KEY = oldOpenAiKey;
    else delete process.env.OPENAI_API_KEY;
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test("getStagedDiff, getStagedSummary, and getStagedFiles do not execute configured ext-diff or textconv helpers", async () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "gp-extdiff-test-"));
  const oldCwd = process.cwd();

  try {
    process.chdir(tmpRepo);
    await execa("git", ["init", "-q", "-b", "main"]);
    await execa("git", ["config", "user.name", "Test"]);
    await execa("git", ["config", "user.email", "test@example.com"]);

    const extDiffMarker = path.join(tmpRepo, "EXT_DIFF_PWNED");
    const driverMarker = path.join(tmpRepo, "DRIVER_PWNED");
    const textconvMarker = path.join(tmpRepo, "TEXTCONV_PWNED");

    const helperScript = path.join(tmpRepo, "evil-helper.sh");
    fs.writeFileSync(
      helperScript,
      `#!/bin/sh\ntouch "${extDiffMarker}" "${driverMarker}" "${textconvMarker}"\n`,
      { mode: 0o755 }
    );
    fs.chmodSync(helperScript, 0o755);

    // Configure external diff and textconv in local repo config and .gitattributes
    await execa("git", ["config", "diff.external", helperScript]);
    await execa("git", ["config", "diff.evil.command", helperScript]);
    await execa("git", ["config", "diff.evil.textconv", helperScript]);
    fs.writeFileSync(path.join(tmpRepo, ".gitattributes"), "*.txt diff=evil\n");

    fs.writeFileSync(path.join(tmpRepo, "notes.txt"), "initial\n");
    await execa("git", ["add", "notes.txt", ".gitattributes"]);
    await execa("git", ["commit", "-qm", "init"]);

    fs.writeFileSync(path.join(tmpRepo, "notes.txt"), "modified line\n");
    await execa("git", ["add", "notes.txt"]);

    const diff = await getStagedDiff();
    const summary = await getStagedSummary();
    const files = await getStagedFiles();

    assert.match(diff, /\+modified line/);
    assert.match(summary, /M\s+notes\.txt/);
    assert.deepEqual(files, ["notes.txt"]);

    // Prove none of the configured external diff / textconv helpers ran
    assert.equal(fs.existsSync(extDiffMarker), false);
    assert.equal(fs.existsSync(driverMarker), false);
    assert.equal(fs.existsSync(textconvMarker), false);
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test("failing git commit hook stderr is terminal-sanitized while retaining readable diagnostics", async () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "gp-hook-sanitize-"));
  const oldCwd = process.cwd();

  try {
    process.chdir(tmpRepo);
    await execa("git", ["init", "-q", "-b", "main"]);
    await execa("git", ["config", "user.name", "Test"]);
    await execa("git", ["config", "user.email", "test@example.com"]);

    fs.writeFileSync(path.join(tmpRepo, "file.txt"), "hello\n");
    await execa("git", ["add", "file.txt"]);

    const hookDir = path.join(tmpRepo, ".git", "hooks");
    fs.mkdirSync(hookDir, { recursive: true });
    const hookPath = path.join(hookDir, "pre-commit");
    // Emit OSC title escape, ANSI screen clear, and a readable diagnostic line
    fs.writeFileSync(
      hookPath,
      '#!/bin/sh\nprintf "\\033]0;pwned-title\\007\\033[2Jpre-commit lint failed on src/index.js:42\\n" >&2\nexit 1\n',
      { mode: 0o755 }
    );
    fs.chmodSync(hookPath, 0o755);

    await assert.rejects(
      async () => {
        await commit("feat: test hook error sanitization");
      },
      (err) => {
        assert.equal(err.name, "GitCommitError");
        // Terminal escape sequences must be stripped
        assert.equal(err.message.includes("\x1b"), false);
        assert.equal(err.message.includes("\x07"), false);
        assert.equal(err.message.includes("pwned-title"), false);
        // Readable diagnostic message must be preserved
        assert.match(err.message, /pre-commit lint failed on src\/index\.js:42/);
        return true;
      }
    );
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test("parseStagedFileList preserves whitespace and embedded newlines", () => {
  const names = ["  leading and trailing spaces.txt  ", "line1\nline2.txt", "tab\tname"];
  assert.deepEqual(parseStagedFileList(`${names.join("\0")}\0`), names);
});

test("getStagedFiles preserves supported unusual filenames via NUL-delimited output", async () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "gp-nul-files-"));
  const oldCwd = process.cwd();

  try {
    process.chdir(tmpRepo);
    await execa("git", ["init", "-q", "-b", "main"]);
    await execa("git", ["config", "user.name", "Test"]);
    await execa("git", ["config", "user.email", "test@example.com"]);

    // Windows normalizes trailing spaces in filesystem paths, so exercise leading
    // spaces there and verify all opaque NUL-delimited cases in the parser test above.
    const spaceFile =
      process.platform === "win32" ? "  leading spaces.txt" : "  leading and trailing spaces.txt  ";
    const newlineFile = "line1\nline2.txt";

    fs.writeFileSync(path.join(tmpRepo, spaceFile), "spaces\n");
    await execa("git", ["add", "--", spaceFile]);

    const expected = [spaceFile];
    if (process.platform !== "win32") {
      fs.writeFileSync(path.join(tmpRepo, newlineFile), "newline\n");
      await execa("git", ["add", "--", newlineFile]);
      expected.push(newlineFile);
    }

    const staged = await getStagedFiles();
    assert.deepEqual(staged.sort(), expected.sort());
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
