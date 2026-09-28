import { callApi, fitsInRequest, requireString } from "../lib/api.js";
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

const OVERSIZED_PREFIX =
  "The staged changes are too large to display the full diff. " +
  "Please generate a commit message based on the user's intent and this summary of changed files:\n\n";

export async function commitCommand(intent) {
  const spinner = spin("Analyzing your staged changes...");
  try {
    const diff = await git.getStagedDiff();
    if (!diff) {
      spinner.warn("No staged changes found. Please stage your files with `git add`.");
      return;
    }

    let payload = { intent, diff };
    if (!fitsInRequest(payload, diff)) {
      payload = { intent, diff: OVERSIZED_PREFIX + (await git.getStagedSummary()) };
    }

    spinner.text = "Generating commit message...";
    const message = requireString(await callApi("pilot-commit", payload), "message");
    spinner.succeed();

    showBlock("Suggested Message", message);

    const choice = await chooseAcceptEditAbort();
    if (choice === "abort") return aborted("Commit aborted by user.");

    const finalMessage =
      choice === "edit"
        ? await editText("Edit the commit message: ", message, "Commit message cannot be empty.")
        : message;

    await git.commit(finalMessage);
    success("Commit successful!");
  } catch (error) {
    handleError(error, spinner);
  }
}
