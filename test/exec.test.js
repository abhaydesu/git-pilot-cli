import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGitCommand, UnsafeCommandError } from "../src/lib/exec.js";

test("parses a plain git command into argv", () => {
  assert.deepEqual(parseGitCommand("git log -1 -p"), ["log", "-1", "-p"]);
});

test("honors quoting instead of splitting on spaces", () => {
  assert.deepEqual(parseGitCommand('git commit -m "fix: a b c"'), ["commit", "-m", "fix: a b c"]);
  assert.deepEqual(parseGitCommand("git commit -m 'it works'"), ["commit", "-m", "it works"]);
});

test("passes globs through as literal pathspecs", () => {
  assert.deepEqual(parseGitCommand("git add *.js"), ["add", "*.js"]);
});

test("does not expand environment variables", () => {
  assert.deepEqual(parseGitCommand("git log $HOME"), ["log", "$HOME"]);
});

for (const bad of [
  "",
  "   ",
  "git",
  "ls -la",
  "rm -rf /",
  "git status; rm -rf /",
  "git status && rm x",
  "git log | cat",
  "git log > out.txt",
  "git commit -m $(evil)",
  "git status # comment",
]) {
  test(`rejects ${JSON.stringify(bad)}`, () => {
    assert.throws(() => parseGitCommand(bad), UnsafeCommandError);
  });
}
