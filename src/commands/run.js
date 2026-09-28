import chalk from "chalk";
import { callApi } from "../lib/api.js";
import { parseGitCommand, runGit } from "../lib/exec.js";
import { spin, showBlock, confirm, success, aborted, handleError } from "../lib/ui.js";

export async function runCommand(request) {
  const spinner = spin("Fetching the right command...");
  try {
    const { command } = await callApi("pilot-run", { request });

    if (command.startsWith("Error:")) {
      spinner.fail(command);
      process.exit(1);
    }
    spinner.succeed();

    // Validate before showing anything the user might be tempted to confirm.
    const args = parseGitCommand(command);

    console.log(
      chalk.yellow.bold("\nWARNING: The suggested command will be executed on your repository.")
    );
    console.log(chalk.yellow("Always review commands carefully before confirming."));
    showBlock("Suggested Command", command);

    if (!(await confirm("Execute this command?"))) {
      return aborted("Execution aborted by user.");
    }

    await runGit(args);
    success("Command executed successfully!");
  } catch (error) {
    handleError(error, spinner);
  }
}
