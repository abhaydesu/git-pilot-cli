import test from "node:test";
import assert from "node:assert/strict";
import { parseReflogAction, analyzeUndoState } from "../src/commands/undo.js";

test("parseReflogAction extracts action and detail from standard reflog lines", () => {
  assert.deepEqual(parseReflogAction("a1b2c3d HEAD@{0}: commit: feat: add merge helper"), {
    action: "commit",
    detail: "feat: add merge helper",
  });

  assert.deepEqual(
    parseReflogAction("a1b2c3d (HEAD -> main) HEAD@{0}: merge feature/x: Fast-forward"),
    {
      action: "merge feature/x",
      detail: "Fast-forward",
    }
  );

  assert.equal(parseReflogAction("not a reflog line"), null);
});

test("analyzeUndoState does not suggest destructive reset on misleading commit messages or branch names", () => {
  // 1. Commit message containing "merge" and "rebase" must suggest soft reset, NOT reset --hard ORIG_HEAD
  const commitWithMergeWord = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: commit: feat: fix merge and rebase conflict UI",
    rebaseInProgress: false,
    origHeadExists: true,
  });
  assert.deepEqual(commitWithMergeWord, {
    command: "git reset --soft HEAD~1",
    explanation: "This command undoes your last commit but keeps all your changes staged.",
    isDestructive: false,
  });

  // 2. Checkout to a branch named "feat/merge-conflict" must refuse to suggest any undo
  const checkoutMergeBranch = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: checkout: moving from main to feat/merge-conflict-rebase",
    rebaseInProgress: false,
    origHeadExists: true,
  });
  assert.equal(checkoutMergeBranch, null);

  // 3. Initial commit cannot be undone with HEAD~1
  const initialCommit = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: commit (initial): initial merge commit",
    rebaseInProgress: false,
    origHeadExists: false,
  });
  assert.equal(initialCommit, null);

  // 4. Finished rebase in reflog when no rebase is currently in progress must not suggest rebase --abort
  const finishedRebase = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: rebase (finish): returning to refs/heads/feat/branch",
    rebaseInProgress: false,
    origHeadExists: true,
  });
  assert.equal(finishedRebase, null);
});

test("analyzeUndoState prioritizes active rebase, merge, cherry-pick, and revert states over reflog history", () => {
  // Active rebase
  const activeRebase = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: commit: feat: earlier commit",
    repoStates: ["rebase"],
    origHeadExists: true,
  });
  assert.equal(activeRebase?.command, "git rebase --abort");
  assert.equal(activeRebase?.isDestructive, false);

  // Active merge (e.g. conflicted merge where reflog still shows the prior commit)
  const activeMerge = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: commit: feat: earlier commit before conflicted merge",
    repoStates: ["merge"],
    origHeadExists: true,
  });
  assert.equal(activeMerge?.command, "git merge --abort");
  assert.equal(activeMerge?.isDestructive, true);
  assert.match(activeMerge?.explanation || "", /uncommitted changes.*may not be recoverable/i);
  assert.match(activeMerge?.caution || "", /cannot always recover uncommitted changes/i);

  // Active cherry-pick
  const activeCherryPick = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: commit: feat: earlier commit",
    repoStates: ["cherry-pick"],
    origHeadExists: false,
  });
  assert.equal(activeCherryPick?.command, "git cherry-pick --abort");
  assert.equal(activeCherryPick?.isDestructive, false);

  // Active revert
  const activeRevert = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: commit: feat: earlier commit",
    repoStates: ["revert"],
    origHeadExists: false,
  });
  assert.equal(activeRevert?.command, "git revert --abort");
  assert.equal(activeRevert?.isDestructive, false);

  // Ambiguous overlapping states must return null
  const overlapping = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: commit: feat: earlier commit",
    repoStates: ["rebase", "merge"],
    origHeadExists: true,
  });
  assert.equal(overlapping, null);
});

test("analyzeUndoState suggests git reset --hard ORIG_HEAD only for verified completed merges with ORIG_HEAD", () => {
  const realMergeWithOrigHead = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: merge feature/login: Merge made by the 'ort' strategy.",
    repoStates: [],
    origHeadExists: true,
  });
  assert.equal(realMergeWithOrigHead?.command, "git reset --hard ORIG_HEAD");
  assert.equal(realMergeWithOrigHead?.isDestructive, true);

  // If ORIG_HEAD does not exist, refuse to suggest destructive reset
  const mergeWithoutOrigHead = analyzeUndoState({
    reflog: "a1b2c3d HEAD@{0}: merge feature/login: Merge made by the 'ort' strategy.",
    repoStates: [],
    origHeadExists: false,
  });
  assert.equal(mergeWithoutOrigHead, null);
});
