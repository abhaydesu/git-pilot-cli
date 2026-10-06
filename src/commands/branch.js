import chalk from "chalk";
import { GeminiProvider, stripFences } from "../lib/provider.js";
import * as git from "../lib/git.js";
import { branchPrompt } from "../lib/prompts.js";
import { ensureProviderReady } from "./setup.js";
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
  let spinner;
  try {
    const ready = await ensureProviderReady({
      dataDescription: "branch description",
    });
    if (!ready) return;
    const { config, keyInfo } = ready;

    spinner = spin("Generating a conventional branch name...");
    const provider = new GeminiProvider({
      apiKey: keyInfo.key,
      model: config.model,
    });

    const prompt = branchPrompt({ description });
    const rawBranchName = stripFences(await provider.generate(prompt));
    spinner.succeed();

    showBlock("Suggested Branch Name", rawBranchName);

    const choice = await chooseAcceptEditAbort();
    if (choice === "abort") return aborted("Branch creation aborted by user.");

    const chosen =
      choice === "edit"
        ? await editText("Edit the branch name:", rawBranchName, "Branch name cannot be empty")
        : rawBranchName;

    const safeName = git.slugifyBranchName(chosen);
    if (!safeName) {
      console.error(chalk.red("Resulting branch name is empty or invalid. Aborting."));
      process.exit(1);
    }

    await git.createBranch(safeName);
    success(`Switched to new branch '${safeName}'`);
  } catch (error) {
    handleError(error, spinner);
  }
}
