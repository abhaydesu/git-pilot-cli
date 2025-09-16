#!/usr/bin/env node

import { program } from "commander";
import { execa, execaCommand } from "execa";
import axios from "axios";
import inquirer from "inquirer";
import chalk from "chalk";

const getStagedDiff = async () => {
  try {
    const { stdout } = await execa("git", ["diff", "--staged"]);
    return stdout;
  } catch (error) {
    console.error("Error getting git diff:", error.message);
    process.exit(1);
  }
};

const API_URL = "http://localhost:3001/api/commit-message";

program
  .name("git-pilot")
  .description("An AI-powered Git assistant in your command line.");

program
  .command("commit")
  .description("Generate an AI-powered commit message.")
  .argument(
    "<string>",
    'The user\'s intent for the commit (e.g., "add a new feature")'
  )
  .action(async (intent) => {
    console.log("Analyzing your staged changes...");

    const diff = await getStagedDiff();

    if (!diff) {
      console.log(
        chalk.yellow(
          "No staged changes found. Please stage your files with `git add`."
        )
      );
      process.exit(0);
    }

    try {
      console.log("contacting the local AI assistant..");

      const response = await axios.post(API_URL, {
        intent,
        diff,
      });
      const suggestedMessage = response.data.message;

      console.log(chalk.green("\n--- Staged Diff ---"));
      console.log(chalk.cyan(suggestedMessage));
      console.log(chalk.green("-------------------\n"));

      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: "Commit with this message?",
          default: true,
        },
      ]);

      if (confirm) {
        await execa("git", ["commit", "-m", suggestedMessage]);
        console.log(chalk.bgGreen.black("Commit successful!"));
      } else {
        console.log(chalk.red("Commit aborted by user."));
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
          chalk.red("An unexpected error occured: ", error.message)
        );
      }

      process.exit(1);
    }
  });

const API_COMMAND_URL = 'http://localhost:3001/api/git-command';

program
  .command('run')
  .description('Translate natural language into a Git command.')
  .argument('<string>', 'The task you want to perform (e.g. "squash the last 3 commits')
  .action(async (request) => {
    try {
        console.log("Fetching the right command..");

        const response = await axios.post(API_COMMAND_URL, { request });
        const suggestedCommand = response.data.command;

        if (suggestedCommand.startsWith('Error:')) {
            console.log(chalk.red(suggestedCommand));
            process.exit(1);
        }

        console.log(chalk.green('\n------ Suggested Command ------'));
        console.log(chalk.cyan(suggestedCommand));
        console.log(chalk.green('-------------------------------\n'));

        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: 'Execute this command?',
                default: false,
            },
        ]);

        if (confirm) {
            await execaCommand(suggestedCommand, {stdio: 'inherit'});
            console.log(chalk.bgGreen.black('Command executed successfully!'));
        } else {
            console.log(chalk.red('Execution aborted by user.'));
        }

    } catch (error) {
        console.error(chalk.red('An error occured: ', error.message));
        process.exit(1);
    }
  })

program.parse(process.argv);