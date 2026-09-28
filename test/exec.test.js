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

test("keeps paths after -- from being treated as options", () => {
  assert.deepEqual(parseGitCommand("git add -- --output"), ["add", "--", "--output"]);
});

test("allows ordinary options on allowed subcommands", () => {
  assert.deepEqual(parseGitCommand("git push -u origin main"), ["push", "-u", "origin", "main"]);
  assert.deepEqual(parseGitCommand("git rebase -i HEAD~3"), ["rebase", "-i", "HEAD~3"]);
});

for (const bad of [
  "git -c core.pager=evil log",
  "git -C /tmp status",
  "git --exec-path=/tmp/x status",
  "git config alias.x '!evil'",
  "git daemon",
  "git fetch --upload-pack=evil origin",
  "git push --receive-pack=evil origin",
  "git rebase -x 'touch x' HEAD~1",
  "git rebase --exec 'touch x' HEAD~1",
  "git clone -u evil url",
  "git log --output=/tmp/x",
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
