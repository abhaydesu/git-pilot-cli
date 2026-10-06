import chalk from "chalk";
import { GeminiProvider, stripFences } from "../lib/provider.js";
import { parseGitCommand, runGit } from "../lib/exec.js";
import { runPrompt, runRetryPrompt } from "../lib/prompts.js";
import { ensureProviderReady } from "./setup.js";
import { spin, showBlock, confirm, success, aborted, handleError } from "../lib/ui.js";

const ERROR_PREFIX = "Error:";

export async function runCommand(request) {
  let spinner;
  try {
    const ready = await ensureProviderReady({
      dataDescription: "natural-language Git command request",
    });
    if (!ready) return;
    const { config, keyInfo } = ready;

    spinner = spin("Translating your request into a Git command...");
    const provider = new GeminiProvider({
      apiKey: keyInfo.key,
      model: config.model,
    });

    let command = stripFences(await provider.generate(runPrompt({ request })));
    if (command.startsWith(ERROR_PREFIX)) {
      spinner.fail(command);
      process.exit(1);
    }

    // Try parsing; if not safe, retry once with the model
    let args;
    try {
      args = parseGitCommand(command);
    } catch {
      const [, verb = command] = command.split(/\s+/);
      command = stripFences(
        await provider.generate(runRetryPrompt({ request, previous: command, verb }))
      );
      if (command.startsWith(ERROR_PREFIX)) {
        spinner.fail(command);
        process.exit(1);
      }
      args = parseGitCommand(command);
    }

    spinner.succeed();

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
