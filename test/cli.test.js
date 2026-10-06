import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArgs, extractCommitIntent, buildProgram } from "../src/cli.js";

test("normalizeArgs dispatches no-arg invocation to commit command", () => {
  const result = normalizeArgs(["node", "git-pilot"]);
  assert.deepEqual(result, ["node", "git-pilot", "commit"]);
});

test("normalizeArgs preserves explicit subcommands", () => {
  for (const cmd of ["commit", "run", "undo", "branch", "setup", "auth"]) {
    const result = normalizeArgs(["node", "git-pilot", cmd]);
    assert.deepEqual(result, ["node", "git-pilot", cmd]);
  }
});

test("normalizeArgs preserves bare intent tokens for commit", () => {
  const result = normalizeArgs(["node", "git-pilot", "add", "login", "throttling"]);
  assert.deepEqual(result, ["node", "git-pilot", "commit", "add", "login", "throttling"]);
});

test("normalizeArgs handles -m flag without subcommand", () => {
  const result = normalizeArgs(["node", "git-pilot", "-m", "fix auth issue"]);
  assert.deepEqual(result, ["node", "git-pilot", "commit", "-m", "fix auth issue"]);
});

test("normalizeArgs does not swallow unknown flags into commit intent", () => {
  const result = normalizeArgs(["node", "git-pilot", "--unknown-flag"]);
  assert.deepEqual(result, ["node", "git-pilot", "--unknown-flag"]);
});

test("normalizeArgs preserves global flags", () => {
  assert.deepEqual(normalizeArgs(["node", "git-pilot", "--help"]), ["node", "git-pilot", "--help"]);
  assert.deepEqual(normalizeArgs(["node", "git-pilot", "-V"]), ["node", "git-pilot", "-V"]);
  assert.deepEqual(normalizeArgs(["node", "git-pilot", "--version"]), [
    "node",
    "git-pilot",
    "--version",
  ]);
});

test("extractCommitIntent preserves all words for quoted -m, unquoted multi-word -m, and bare intent", () => {
  assert.equal(extractCommitIntent([], {}), undefined);
  assert.equal(extractCommitIntent(["add", "login", "throttling"], {}), "add login throttling");
  assert.equal(
    extractCommitIntent([], { messageContext: "add login throttling" }),
    "add login throttling"
  );
  assert.equal(
    extractCommitIntent(["login", "throttling"], { messageContext: "add" }),
    "add login throttling"
  );
});

test("CLI program parseAsync passes complete multi-word intent for both bare words and -m", async () => {
  const received = [];
  const makeProgram = () =>
    buildProgram({
      handlers: {
        commit: async (intent, options) => {
          received.push({ intent, dryRun: Boolean(options.dryRun) });
        },
        setup: async () => {},
        authStatus: async () => {},
        authRemove: async () => {},
        run: async () => {},
        undo: async () => {},
        branch: async () => {},
      },
    });

  // 1. Bare multi-word intent: `git pilot add login throttling`
  await makeProgram().parseAsync(
    normalizeArgs(["node", "git-pilot", "add", "login", "throttling"])
  );

  // 2. Unquoted multi-word -m: `git pilot -m add login throttling`
  await makeProgram().parseAsync(
    normalizeArgs(["node", "git-pilot", "-m", "add", "login", "throttling"])
  );

  // 3. Quoted -m: `git pilot -m "add login throttling"`
  await makeProgram().parseAsync(
    normalizeArgs(["node", "git-pilot", "-m", "add login throttling"])
  );

  // 4. Explicit commit subcommand with unquoted multi-word -m: `git pilot commit -m add login throttling`
  await makeProgram().parseAsync(
    normalizeArgs(["node", "git-pilot", "commit", "-m", "add", "login", "throttling"])
  );

  // 5. Bare --dry-run with multi-word -m
  await makeProgram().parseAsync(
    normalizeArgs(["node", "git-pilot", "--dry-run", "-m", "add", "login", "throttling"])
  );

  assert.deepEqual(received, [
    { intent: "add login throttling", dryRun: false },
    { intent: "add login throttling", dryRun: false },
    { intent: "add login throttling", dryRun: false },
    { intent: "add login throttling", dryRun: false },
    { intent: "add login throttling", dryRun: true },
  ]);
});

test("buildProgram registers all required commands and options", () => {
  const program = buildProgram();
  const commandNames = program.commands.map((c) => c.name());
  assert.ok(commandNames.includes("commit"));
  assert.ok(commandNames.includes("run"));
  assert.ok(commandNames.includes("undo"));
  assert.ok(commandNames.includes("branch"));
  assert.ok(commandNames.includes("setup"));
  assert.ok(commandNames.includes("auth"));

  const commitCmd = program.commands.find((c) => c.name() === "commit");
  assert.ok(commitCmd.options.some((o) => o.flags.includes("-m")));
  assert.ok(commitCmd.options.some((o) => o.flags.includes("--dry-run")));

  const authCmd = program.commands.find((c) => c.name() === "auth");
  const authSubNames = authCmd.commands.map((c) => c.name());
  assert.ok(authSubNames.includes("status"));
  assert.ok(authSubNames.includes("remove"));
});
