import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { describeError } from "./api.js";
import { UnsafeCommandError } from "./exec.js";

// ora 9.x divides by stream.columns; a PTY that reports 0 columns makes its
// redraw loop spin forever. Give it a sane fallback.
if (!process.stderr.columns) process.stderr.columns = 80;

// discardStdin is off so the spinner never swallows the input inquirer needs next.
export const spin = (text) => ora({ text, discardStdin: false }).start();

export function showBlock(title, body) {
  const bar = "-".repeat(title.length + 14);
  console.log(chalk.green(`\n------ ${title} ------`));
  console.log(chalk.cyan(body));
  console.log(chalk.green(`${bar}\n`));
}

export async function confirm(message) {
  const { ok } = await inquirer.prompt([{ type: "confirm", name: "ok", message, default: false }]);
  return ok;
}

/** Accept / Edit / Abort menu; returns "accept" | "edit" | "abort". */
export async function chooseAcceptEditAbort() {
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "What would you like to do?",
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

export const success = (text) => console.log(chalk.bgGreen.black(text));
export const aborted = (text) => console.log(chalk.red(text));

/** Prints an error, stops the spinner if it is running, and exits non-zero. */
export function handleError(error, spinner) {
  if (spinner?.isSpinning) spinner.fail();

  if (error?.name === "ExitPromptError") {
    console.error(chalk.red("\nCancelled."));
    process.exit(130);
  }
  if (error instanceof UnsafeCommandError) {
    console.error(chalk.red(`Refusing to run: ${error.message}`));
  } else {
    console.error(chalk.red(describeError(error)));
  }
  process.exit(1);
}
