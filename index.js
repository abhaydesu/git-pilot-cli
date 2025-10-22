#!/usr/bin/env node

import { program } from "commander";
import { execa, execaCommand } from "execa";
import axios from "axios";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";

const API_BRANCH_URL = "https://git-pilot-api.vercel.app/api/pilot-branch";
const API_COMMIT_URL = "https://git-pilot-api.vercel.app/api/pilot-commit";
const API_COMMAND_URL = "https://git-pilot-api.vercel.app/api/pilot-run";
const API_UNDO_URL = "https://git-pilot-api.vercel.app/api/pilot-undo";

const getStagedDiff = async () => {
  try {
    const { stdout } = await execa("git", ["diff", "--staged"]);
    return stdout;
  } catch (error) {
    console.error(
      chalk.red("Error getting git diff:"),
      error?.message || error
    );
    process.exit(1);
  }
};

program
  .name("git-pilot")
  .description("An AI-powered Git assistant in your command line.");

program
  .command("commit")
  .description("Generate an AI-powered commit message.")
  .argument(
    "[intent]",
    'Optional: The user\'s intent for the commit (e.g., "add a new feature")'
  )
  .action(async (intent) => {
    const spinner = ora("Analyzing your staged changes...").start();

    const diff = await getStagedDiff();

    if (!diff) {
      spinner.warn(
        "No staged changes found. Please stage your files with `git add`."
      );
      process.exit(0);
    }

    const MAX_PAYLOAD_SIZE = 4 * 1024 * 1024; 
    const diffSize = Buffer.byteLength(diff, 'utf8');
    let diffToSend = diff;

    if (diffSize > MAX_PAYLOAD_SIZE) {
      
      const { stdout: diffSummary } = await execa("git", ["diff", "--staged", "--name-status"]);
      
      diffToSend = "The staged changes are too large to display the full diff. " +
                   "Please generate a commit message based on the user's intent and this summary of changed files:\n\n" +
                   diffSummary;
    }

    try {
      spinner.text = "Generating commit message...";

      const response = await axios.post(
        API_COMMIT_URL,
        { intent, diff: diffToSend },
        { timeout: 30000 }
      );

      const suggestedMessage = response.data.message;

      spinner.succeed();

      console.log(chalk.green("\n--- Suggested Message ---"));
      console.log(chalk.cyan(suggestedMessage));
      console.log(chalk.green("-------------------------\n"));

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

      if (choice === 'abort') {
        console.log(chalk.red('Commit aborted by user.'));
        process.exit(0);
      }

      if (choice == "edit") {
        const { editedMessage } = await inquirer.prompt([
          {
            type: "editor",
            name: "editedMessage",
            message: "Edit the commit message: ",
            default: suggestedMessage,
            validate: (input) =>
              input.length > 0 ? true : "Commit message cannot be empty.",
          },
        ]);

        await execa("git", ["commit", "-m", editedMessage]);
        console.log(chalk.bgGreen.black("Commit successful!"));
      }

      if (choice === "accept") {
        await execa("git", ["commit", "-m", suggestedMessage]);
        console.log(chalk.bgGreen.black("Commit successful!"));
      }

    } catch (error) {
      if (error.response) {
        console.error(
          chalk.red(
            `API Error: ${error.response.status} - ${error.response.data.error}`
          )
        );
      } else {
        console.error(
          chalk.red("An unexpected error occurred: ", error.message)
        );
      }

      process.exit(1);
    }
  });

program
  .command("run")
  .description("Translate natural language into a Git command.")
  .argument(
    "<string>",
    'The task you want to perform (e.g. "squash the last 3 commits")'
  )
  .action(async (request) => {
    try {
      const spinner = ora("Fetching the right command...").start();

      const response = await axios.post(
        API_COMMAND_URL,
        { request },
        { timeout: 30000 }
      );
      const suggestedCommand = response.data.command;

      if (suggestedCommand.startsWith("Error:")) {
        spinner.fail(suggestedCommand);
        process.exit(1);
      }

      spinner.succeed();

      console.log(
        chalk.yellow.bold(
          "\nWARNING: The suggested command will be executed in your shell."
        )
      );
      console.log(
        chalk.yellow("Always review commands carefully before confirming.\n")
      );

      console.log(chalk.green("\n------ Suggested Command ------"));
      console.log(chalk.cyan(suggestedCommand));
      console.log(chalk.green("-------------------------------\n"));

      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: "Execute this command?",
          default: false,
        },
      ]);

      if (confirm) {
        await execaCommand(suggestedCommand, { stdio: "inherit" });
        console.log(chalk.bgGreen.black("Command executed successfully!"));
      } else {
        console.log(chalk.red("Execution aborted by user."));
      }
    } catch (error) {
      if (error.response) {
        console.error(
          chalk.red(
            `API Error: ${error.response.status} - ${
              error.response.data.error || "No message"
            }`
          )
        );
      } else {
        console.error(
          chalk.red(`An unexpected error occurred: ${error.message}`)
        );
      }

      process.exit(1);
    }
  });

program
  .command("undo")
  .description("Suggests a command to undo your last major Git action")
  .action(async () => {
    const spinner = ora("Analyzing your recent Git history...").start();

    try {
      const { stdout: reflog } = await execa("git", ["reflog", "-n", "15"]);

      spinner.text = "Suggesting an undo command...";

      const response = await axios.post(API_UNDO_URL, { reflog });
      const { command, explanation } = response.data;

      if (!command) {
        spinner.warn("Couldn't determine a safe action to undo.");
        process.exit(0);
      }

      spinner.succeed();

      console.log(chalk.green("\n--- Suggested Undo Command ---"));
      console.log(chalk.cyan(command));
      console.log(chalk.green("------------------------------\n"));
      console.log(chalk.yellow(explanation));

      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: "Execute this undo command?",
          default: false,
        },
      ]);

      if (confirm) {
        if (command.startsWith('git rebase --abort')) {
          try {
            const { stdout: gitDirRaw } = await execa('git', ['rev-parse', '--git-dir']);
            const gitDir = gitDirRaw.trim();

            const fs = await import('fs/promises');

            const rebaseApply = `${gitDir}/rebase-apply`;
            const rebaseMerge = `${gitDir}/rebase-merge`;

            const hasRebaseApply = await fs.access(rebaseApply).then(() => true).catch(() => false);
            const hasRebaseMerge = await fs.access(rebaseMerge).then(() => true).catch(() => false);

            if (!hasRebaseApply && !hasRebaseMerge) {
              console.log(chalk.yellow('No rebase in progress — abort not necessary.'));
              process.exit(0);
            }
          } catch (e) {
          }
        }

        await execaCommand(command, { stdio: "inherit" });        
        console.log(chalk.bgGreen.black("Action successfully undone!"));
      } else {
        console.log(chalk.red("Execution aborted by user."));
      }
    } catch (error) {
      spinner.fail();

      if (error.response) {
        console.error(chalk.red(`API Error: ${error.response.status} - ${error.response.data.error || 'No message'}`));
      } else {
        console.error(chalk.red(`An unexpected error occurred: ${error.message}`));
      }

      process.exit(1);
    }
  });

  program
  .command('branch')
  .description('Generates a conventional branch name from a description and creates the branch.')
  .argument('<string>', 'A description of the branch\'s purpose (e.g., "fix login bug")')
  .action(async (description) => {
    const spinner = ora('Generating a conventional branch name...').start();
    try {
      const response = await axios.post(API_BRANCH_URL, { description });
      const { branchName } = response.data;

      spinner.succeed();

      console.log(chalk.green('\n--- Suggested Branch Name ---'));
      console.log(chalk.cyan(branchName));
      console.log(chalk.green('-----------------------------\n'));

      const { choice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'choice',
          message: 'What would you like to do?',
          choices: [
            { name: 'Accept', value: 'accept' },
            { name: 'Edit', value: 'edit' },
            { name: 'Abort', value: 'abort' },
          ],
        },
      ]);

      if (choice === 'abort') {
        console.log(chalk.red('Branch creation aborted by user.'));
        process.exit(0);
      }

      let finalBranchName = branchName;

      if (choice === 'edit') {
        const editResp = await inquirer.prompt({
          type: 'editor',
          name: 'editedBranchName',
          message: 'Edit the branch name:',
          default: branchName,
          validate: value => (value && value.trim().length > 0) ? true : 'Branch name cannot be empty'
        }, {
              onCancel: () => {
                console.log(chalk.red('\nEdit cancelled.'));
                process.exit(0);
                }
        });

        finalBranchName = editResp.editedBranchName;
      }

      const slugifyBranchName = (name) =>
        name
          .toLowerCase()
          .trim()
          .replace(/\s+/g, '-')             
          .replace(/[^a-z0-9._\-\/]/g, '') 
          .replace(/\/{2,}/g, '/')        
          .replace(/^-+|-+$/g, '')        
          .slice(0, 250);

      const safeBranchName = slugifyBranchName(finalBranchName || '');

      if (!safeBranchName) {
        console.log(chalk.red('Resulting branch name is empty or invalid. Aborting.'));
        process.exit(1);
      }

      await execa('git', ['switch', '-c', safeBranchName]);
      console.log(chalk.bgGreen.black(`✔ Switched to new branch '${safeBranchName}'`));

    } catch (error) {
      spinner.fail();
      if (error.response) {
        console.error(chalk.red(`API Error: ${error.response.status} - ${error.response.data.error || 'No message'}`));
      } else {
        console.error(chalk.red(`An unexpected error occurred: ${error.message}`));
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
