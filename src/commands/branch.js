import chalk from "chalk";
import { callApi, requireString } from "../lib/api.js";
import * as git from "../lib/git.js";
import {
  spin,
  showBlock,
  chooseAcceptEditAbort,
  editText,
  success,
  aborted,
  handleError,
} from "../lib/ui.js";

export async function branchCommand(description) {
  const spinner = spin("Generating a conventional branch name...");
  try {
    const branchName = requireString(await callApi("pilot-branch", { description }), "branchName");
    spinner.succeed();

    showBlock("Suggested Branch Name", branchName);

    const choice = await chooseAcceptEditAbort();
    if (choice === "abort") return aborted("Branch creation aborted by user.");

    const chosen =
      choice === "edit"
        ? await editText("Edit the branch name:", branchName, "Branch name cannot be empty")
        : branchName;

    const safeName = git.slugifyBranchName(chosen);
    if (!safeName) {
      console.log(chalk.red("Resulting branch name is empty or invalid. Aborting."));
      process.exit(1);
    }

    await git.createBranch(safeName);
    success(`✔ Switched to new branch '${safeName}'`);
  } catch (error) {
    handleError(error, spinner);
  }
}
