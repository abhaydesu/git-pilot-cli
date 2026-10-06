import chalk from "chalk";
import { parseGitCommand, runGit } from "../lib/exec.js";
import * as git from "../lib/git.js";
import { spin, showBlock, confirm, success, aborted, handleError } from "../lib/ui.js";

/**
 * Parses a standard Git reflog line (`<sha> HEAD@{<n>}: <action>: <detail>`)
 * into `{ action, detail }`, or returns `null` if the line does not match.
 * Prevents substring false-positives when commit messages or branch names
 * contain words like "merge" or "rebase".
 */
export function parseReflogAction(line) {
  if (typeof line !== "string" || !line.trim()) return null;
  const match = /(?:^|\s)HEAD@\{\d+\}:\s*([^:]+):\s*(.*)$/.exec(line.trim());
  if (!match) return null;
  return {
    action: match[1].trim(),
    detail: match[2].trim(),
  };
}

const ACTIVE_OPERATION_SUGGESTIONS = {
  rebase: {
    command: "git rebase --abort",
    explanation: "This command cancels the active rebase operation and restores your branch.",
    isDestructive: false,
  },
  merge: {
    command: "git merge --abort",
    explanation:
      "This command attempts to abort the in-progress merge. " +
      "Warning: if you had uncommitted changes before starting the merge (or edited conflicted files), some pre-merge changes may not be recoverable.",
    isDestructive: true,
    caution:
      "\nCAUTION: `git merge --abort` discards in-progress merge conflict edits and cannot always recover uncommitted changes that existed before the merge started.",
  },
  "cherry-pick": {
    command: "git cherry-pick --abort",
    explanation: "This command cancels the active cherry-pick operation and restores your branch.",
    isDestructive: false,
  },
  revert: {
    command: "git revert --abort",
    explanation: "This command cancels the active revert operation and restores your branch.",
    isDestructive: false,
  },
};

/**
 * Determines a safe undo suggestion from repository state and the latest reflog entry.
 * Always checks active Git operations (rebase, merge, cherry-pick, revert) first before
 * inspecting historical reflog entries, and refuses to suggest destructive operations
 * when the state is ambiguous.
 */
export function analyzeUndoState({
  reflog,
  repoStates = [],
  rebaseInProgress = false,
  origHeadExists = false,
} = {}) {
  const activeStates = Array.isArray(repoStates) ? [...repoStates] : [];
  if (rebaseInProgress && !activeStates.includes("rebase")) {
    activeStates.push("rebase");
  }

  // If multiple operations appear active simultaneously, state is ambiguous
  if (activeStates.length > 1) {
    return null;
  }

  if (activeStates.length === 1) {
    const activeOp = activeStates[0];
    return ACTIVE_OPERATION_SUGGESTIONS[activeOp] || null;
  }

  const firstLine =
    String(reflog || "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) || "";

  const parsed = parseReflogAction(firstLine);
  if (!parsed) return null;

  const { action, detail } = parsed;

  // Standard commit or amend (explicitly excluding `commit (initial)` which has no HEAD~1 parent)
  if (action === "commit" || action === "commit (amend)") {
    return {
      command: "git reset --soft HEAD~1",
      explanation: "This command undoes your last commit but keeps all your changes staged.",
      isDestructive: false,
    };
  }

  // Completed merge or fast-forward pull: require both an explicit merge/pull action
  // AND a verified ORIG_HEAD reference before suggesting a destructive hard reset.
  const isMergeAction =
    action === "merge" ||
    action.startsWith("merge ") ||
    action === "pull" ||
    action.startsWith("pull ");
  const isCompletedMergeDetail = /^(Fast-forward|Merge made by\b)/i.test(detail);

  if (isMergeAction && isCompletedMergeDetail && origHeadExists) {
    return {
      command: "git reset --hard ORIG_HEAD",
      explanation: "This command resets your branch to ORIG_HEAD (the state before the merge).",
      isDestructive: true,
      caution:
        "\nCAUTION: This command is destructive (`git reset --hard`) and will discard uncommitted changes.",
    };
  }

  return null;
}

export async function undoCommand() {
  const spinner = spin("Analyzing your recent Git history...");
  try {
    const [reflog, repoStates, origHeadExists] = await Promise.all([
      git.getReflog(),
      git.getGitRepoState(),
      git.hasOrigHead(),
    ]);

    const suggestion = analyzeUndoState({
      reflog,
      repoStates,
      origHeadExists,
    });

    if (!suggestion) {
      spinner.warn("Couldn't determine a safe, unambiguous action to undo from recent Git state.");
      return;
    }

    spinner.succeed();

    const { command, explanation, isDestructive, caution } = suggestion;
    const args = parseGitCommand(command);

    if (isDestructive) {
      console.log(
        chalk.red.bold(
          caution ||
            "\nCAUTION: This command is destructive (`git reset --hard`) and will discard uncommitted changes."
        )
      );
    }
    showBlock("Suggested Undo Command", command);
    console.log(chalk.yellow(explanation));

    if (!(await confirm("Execute this undo command?"))) {
      return aborted("Execution aborted by user.");
    }

    if (args.includes("--abort") && args[0] in ACTIVE_OPERATION_SUGGESTIONS) {
      const currentStates = await git.getGitRepoState();
      if (!currentStates.includes(args[0])) {
        return console.log(chalk.yellow(`No ${args[0]} in progress — abort not necessary.`));
      }
    }

    await runGit(args);
    success("Action successfully undone!");
  } catch (error) {
    handleError(error, spinner);
  }
}
