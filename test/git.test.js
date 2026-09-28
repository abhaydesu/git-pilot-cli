import { test } from "node:test";
import assert from "node:assert/strict";
import { slugifyBranchName } from "../src/lib/git.js";

test("slugifyBranchName", () => {
  assert.equal(slugifyBranchName("Fix Login Bug"), "fix-login-bug");
  assert.equal(slugifyBranchName("  feature/Add  Thing "), "feature/add-thing");
  assert.equal(slugifyBranchName("fix/a//b"), "fix/a/b");
  assert.equal(slugifyBranchName("bad;name$(x)"), "badnamex");
  assert.equal(slugifyBranchName("---"), "");
  assert.equal(slugifyBranchName("x".repeat(400)).length, 250);
});
