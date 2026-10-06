import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import process from "node:process";
import { UnsafeCommandError } from "./exec.js";
import { ProviderError } from "./provider.js";
import { GitCommitError } from "./git.js";
import { CredentialStoreUnavailableError, redactSecretText } from "./credentials.js";
import { sanitizeTerminalText } from "./sanitizer.js";

// Check NO_COLOR standard (https://no-color.org)
if (process.env.NO_COLOR) {
  chalk.level = 0;
}

// ora 9.x column fallback
if (!process.stderr.columns) process.stderr.columns = 80;

export const spin = (text) => ora({ text, discardStdin: false, stream: process.stderr }).start();

export function showBlock(title, body) {
  const bar = "-".repeat(Math.max(title.length + 14, 30));
  console.log(chalk.green(`\n------ ${title} ------`));
  console.log(chalk.cyan(body));
  console.log(chalk.green(`${bar}\n`));
}

export function showPanel({ title, details = [], content, stream = process.stdout }) {
  const write = (line) => stream.write(line + "\n");
  write(chalk.bold.cyan(`\n╭─ ${title} ` + "─".repeat(Math.max(0, 50 - title.length))));
  for (const detail of details) {
    write(chalk.dim(`│  ${detail}`));
  }
  if (details.length > 0) {
    write(chalk.dim(`├${"─".repeat(55)}`));
  }
  const lines = (content || "").split("\n");
  for (const line of lines) {
    write(`│  ${chalk.white(line)}`);
  }
  write(chalk.bold.cyan(`╰${"─".repeat(56)}\n`));
}

export async function confirm(message, defaultVal = false) {
  const { ok } = await inquirer.prompt([
    { type: "confirm", name: "ok", message, default: defaultVal },
  ]);
  return ok;
}

/**
 * Action menu for commit flow: returns "accept" | "edit" | "regenerate" | "abort".
 * Default selection is "abort" (non-destructive) so pressing Enter accidentally
 * never creates an unintended commit.
 */
export async function chooseCommitAction() {
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      default: "abort",
      choices: [
        { name: "Accept and commit", value: "accept" },
        { name: "Edit in $EDITOR", value: "edit" },
        { name: "Regenerate message", value: "regenerate" },
        { name: "Abort", value: "abort" },
      ],
    },
  ]);
  return action;
}

/** Accept / Edit / Abort menu; returns "accept" | "edit" | "abort". */
export async function chooseAcceptEditAbort() {
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "What would you like to do?",
      default: "abort",
      choices: [
        { name: "Accept", value: "accept" },
        { name: "Edit", value: "edit" },
        { name: "Abort", value: "abort" },
      ],
    },
  ]);
  return choice;
}

/** Opens $EDITOR on `initial`; returns the trimmed result. */
export async function editText(message, initial, emptyMessage) {
  const { text } = await inquirer.prompt([
    {
      type: "editor",
      name: "text",
      message,
      default: initial,
      validate: (input) => (input.trim().length > 0 ? true : emptyMessage),
    },
  ]);
  return text.trim();
}

/** Non-echoing masked password prompt */
export async function promptMaskedPassword(message) {
  const { secret } = await inquirer.prompt([
    {
      type: "password",
      name: "secret",
      message,
      mask: "*",
      validate: (input) => (input.trim().length > 0 ? true : "Input cannot be empty."),
    },
  ]);
  return secret.trim();
}

export const success = (text) => console.log(chalk.green(`✔ ${text}`));
export const warn = (text) => console.error(chalk.yellow(`⚠ ${text}`));
export const info = (text) => console.error(chalk.blue(`ℹ ${text}`));
export const aborted = (text) => console.log(chalk.dim(`Cancelled. ${text}`));

export function formatSafeErrorText(text) {
  return sanitizeTerminalText(redactSecretText(String(text || "")));
}

/** Prints an error, stops the spinner if it is running, and exits non-zero. */
export function handleError(error, spinner) {
  if (spinner?.isSpinning) spinner.fail();

  if (error?.name === "ExitPromptError") {
    console.error(chalk.dim("\nCancelled by user."));
    process.exit(130);
  }

  if (error instanceof CredentialStoreUnavailableError) {
    console.error(chalk.red.bold(`\nCredential Store Unavailable:`));
    console.error(chalk.red(formatSafeErrorText(error.message)));
    console.error(
      chalk.yellow(
        "\nTip: For CI or automated environments, you can alternatively set the GEMINI_API_KEY environment variable."
      )
    );
    process.exit(1);
  }

  if (error instanceof UnsafeCommandError) {
    console.error(chalk.red(`Refusing to run: ${formatSafeErrorText(error.message)}`));
    process.exit(1);
  }

  if (error instanceof ProviderError) {
    console.error(chalk.red(`Provider Error: ${formatSafeErrorText(error.message)}`));
    process.exit(1);
  }

  if (error instanceof GitCommitError) {
    console.error(chalk.red(`\nCommit Error: ${formatSafeErrorText(error.message)}`));
    console.error(chalk.yellow(`\nYour generated message was preserved:`));
    console.error(chalk.cyan(sanitizeTerminalText(error.commitMessage)));
    process.exit(1);
  }

  console.error(
    chalk.red(
      `An unexpected error occurred: ${formatSafeErrorText(error?.message || String(error))}`
    )
  );
  process.exit(1);
}
