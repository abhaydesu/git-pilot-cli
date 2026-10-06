import chalk from "chalk";
import process from "node:process";
import * as defaultGit from "../lib/git.js";
import { GeminiProvider, fitsInGeminiRequest, boundSummary } from "../lib/provider.js";
import { scanDiffForSecrets } from "../lib/scanner.js";
import { sanitizeTerminalText } from "../lib/sanitizer.js";
import { commitPrompt } from "../lib/prompts.js";
import { ensureProviderReady } from "./setup.js";
import {
  spin,
  showPanel,
  chooseCommitAction,
  editText,
  success,
  aborted,
  warn,
  handleError,
} from "../lib/ui.js";

export const OVERSIZED_PREFIX =
  "The staged changes are too large to display the full diff. " +
  "Please generate a commit message based on the user's intent and this summary of changed files:\n\n";

/**
 * Builds the commit prompt, falling back to a byte-bounded file summary if the
 * full diff exceeds character or UTF-8 JSON request byte limits.
 */
export async function buildBoundedCommitPrompt({ intent, diff, getSummary }) {
  const fullPrompt = commitPrompt({ intent, diff });
  if (fitsInGeminiRequest(fullPrompt, diff)) {
    return fullPrompt;
  }

  const rawSummary = await getSummary();
  const safeSummary = boundSummary(rawSummary);
  return commitPrompt({
    intent,
    diff: OVERSIZED_PREFIX + safeSummary,
  });
}

export async function commitCommand(intent, options = {}, deps = {}) {
  const git = deps.git || defaultGit;
  const createProvider = deps.createProvider || ((opts) => new GeminiProvider(opts));
  const chooseAction = deps.chooseAction || chooseCommitAction;
  const editMessage = deps.editMessage || editText;
  const ensureReady = deps.ensureReady || ensureProviderReady;

  let activeSpinner;
  try {
    // Pre-flight 1: Check Git repository
    if (!(await git.isInsideGitRepo())) {
      console.error(
        chalk.red(
          "Fatal: Not inside a Git repository. Please run git-pilot inside a Git repository."
        )
      );
      process.exit(1);
    }

    // Pre-flight 2: Check active Git states (rebase, merge, etc.)
    const states = await git.getGitRepoState();
    if (states.length > 0) {
      warn(
        `Notice: Git operation in progress (${states.join(", ")}). Your commit will apply to this operation.`
      );
    }

    // Pre-flight 3: Check staged changes
    const stagedFiles = await git.getStagedFiles();
    if (stagedFiles.length === 0) {
      console.log(chalk.yellow("\nNo staged changes found."));
      console.log(
        chalk.dim("Stage the changes you want to commit using: ") + chalk.cyan("git add <files>")
      );
      console.log("\nAvailable Git Pilot commands:");
      console.log(
        `  ${chalk.bold("git pilot run <query>")}     Translate natural language into a Git command`
      );
      console.log(`  ${chalk.bold("git pilot undo")}            Undo your last major Git action`);
      console.log(`  ${chalk.bold("git pilot branch <name>")}    Create a conventional branch`);
      console.log(
        `  ${chalk.bold("git pilot setup")}            Configure your AI provider and key`
      );
      console.log(
        `  ${chalk.bold("git pilot auth status")}      Inspect active credential status\n`
      );
      return;
    }

    // Pre-flight 4: Read staged diff & best-effort local secret scan BEFORE setup/network
    const diff = await git.getStagedDiff();
    const scanResult = scanDiffForSecrets(diff);
    if (!scanResult.clean) {
      console.error(
        chalk.bgRed.black.bold("\n SECURITY ALERT: Refusing to send diff to AI provider \n")
      );
      console.error(
        chalk.red(
          "Potential high-confidence secrets or credentials were detected in your staged changes:\n"
        )
      );
      for (const finding of scanResult.findings) {
        console.error(
          `  ${chalk.bold.red(finding.rule)} at line ${finding.line}: ${chalk.yellow(finding.preview)}`
        );
      }
      console.error(
        chalk.dim(
          "\nPlease unstage or remove sensitive material before generating commit messages."
        )
      );
      process.exit(1);
    }

    // Non-interactive check (unless --dry-run is explicitly requested)
    if (!process.stdout.isTTY && !options.dryRun && !deps.allowNonTty) {
      console.error(
        chalk.red(
          "Error: Interactive commit flow requires a TTY terminal. Use --dry-run to output only the generated message."
        )
      );
      process.exit(1);
    }

    // Pre-flight 5: Ensure API key and versioned data-sharing consent
    const ready = await ensureReady({
      dataDescription: "staged git diff and commit intent",
      nonInteractive: Boolean(options.dryRun),
      acceptNotice: Boolean(options.acceptNotice),
    });
    if (!ready) {
      return;
    }
    const { config, keyInfo } = ready;

    // Best-effort snapshot of staged index identity before generation
    const initialSnapshot = await git.getStagedTreeHash();

    const provider = createProvider({
      apiKey: keyInfo.key,
      model: config.model,
    });

    activeSpinner = spin(
      `Analyzing ${stagedFiles.length} staged file${stagedFiles.length === 1 ? "" : "s"} with ${config.provider}...`
    );

    const prompt = await buildBoundedCommitPrompt({
      intent,
      diff,
      getSummary: () => git.getStagedSummary(),
    });
    let currentMessage = sanitizeTerminalText(await provider.generate(prompt));

    if (options.dryRun) {
      activeSpinner.stop();
      process.stdout.write(`${currentMessage}\n`);
      return;
    }

    activeSpinner.succeed();

    // Interactive review loop
    while (true) {
      showPanel({
        title: "Proposed Commit Message",
        details: [
          `Provider: ${config.provider} (${config.model})`,
          `Staged files: ${stagedFiles.length} (${stagedFiles.slice(0, 3).join(", ")}${stagedFiles.length > 3 ? "..." : ""})`,
          intent ? `User intent: "${intent}"` : "User intent: (none)",
        ],
        content: currentMessage,
      });

      const action = await chooseAction();

      if (action === "abort") {
        return aborted("Commit cancelled by user. No changes were committed.");
      }

      if (action === "edit") {
        currentMessage = await editMessage(
          "Edit the commit message: ",
          currentMessage,
          "Commit message cannot be empty."
        );
        continue;
      }

      if (action === "regenerate") {
        activeSpinner = spin("Regenerating commit message with Gemini...");
        const regenPrompt = await buildBoundedCommitPrompt({
          intent,
          diff,
          getSummary: () => git.getStagedSummary(),
        });
        currentMessage = sanitizeTerminalText(await provider.generate(regenPrompt));
        activeSpinner.succeed("New message generated.");
        continue;
      }

      if (action === "accept") {
        if (deps.beforeSnapshotRecheck) {
          await deps.beforeSnapshotRecheck();
        }
        // Best-effort re-check of index snapshot immediately before invoking `git commit`
        const postSnapshot = await git.getStagedTreeHash();
        if (postSnapshot !== initialSnapshot) {
          console.error(
            chalk.red(
              "\nError: Staged changes have changed since this commit message was generated."
            )
          );
          console.error(
            chalk.yellow(
              "Please run `git pilot` again to generate a message for the updated index."
            )
          );
          process.exit(1);
        }

        activeSpinner = spin("Creating Git commit...");
        await git.commit(currentMessage);
        activeSpinner.succeed("Commit created successfully!");
        success(`Committed with message: "${currentMessage.split("\n")[0]}"`);
        return;
      }
    }
  } catch (err) {
    handleError(err, activeSpinner);
  }
}
