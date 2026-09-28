import chalk from "chalk";
import { callApi } from "../lib/api.js";
import { parseGitCommand, runGit } from "../lib/exec.js";
import * as git from "../lib/git.js";
import { spin, showBlock, confirm, success, aborted, handleError } from "../lib/ui.js";

export async function undoCommand() {
  const spinner = spin("Analyzing your recent Git history...");
  try {
    const reflog = await git.getReflog();

    spinner.text = "Suggesting an undo command...";
    const { command, explanation } = await callApi("pilot-undo", { reflog });

    if (!command) {
      spinner.warn("Couldn't determine a safe action to undo.");
      return;
    }
    spinner.succeed();

    const args = parseGitCommand(command);

    showBlock("Suggested Undo Command", command);
    console.log(chalk.yellow(explanation));

    if (!(await confirm("Execute this undo command?"))) {
      return aborted("Execution aborted by user.");
    }

    if (args[0] === "rebase" && args.includes("--abort") && !(await git.isRebaseInProgress())) {
      return console.log(chalk.yellow("No rebase in progress — abort not necessary."));
    }

    await runGit(args);
    success("Action successfully undone!");
  } catch (error) {
    handleError(error, spinner);
  }
}
