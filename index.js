#!/usr/bin/env node

import { program } from "commander";
import { execa, execaCommand } from "execa";
import axios from "axios";
import inquirer from "inquirer";
import chalk from "chalk";

import ora from "ora";

const API_COMMIT_URL = "http://git-pilot-api.vercel.app/api/commit-message";
const API_COMMAND_URL ="http://git-pilot-api.vercel.app/api/git-command"


const getStagedDiff = async () => {
  try {
    const { stdout } = await execa("git", ["diff", "--staged"]);
    return stdout;
  } catch (error) {
    console.error(chalk.red("Error getting git diff:"), error?.message || error);
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
    "<string>",
    'The user\'s intent for the commit (e.g., "add a new feature")'
  )
  .action(async (intent) => {
    const spinner = ora('Analyzing your staged changes...').start();

    const diff = await getStagedDiff();

    if (!diff) {
      spinner.warn("No staged changes found. Please stage your files with `git add`.");
      process.exit(0);
    }

    try {
      spinner.text = 'Generating commit message...';

      const response = await axios.post(API_COMMIT_URL,
        { intent, diff},
        { timeout: 30000 }
    );

      const suggestedMessage = response.data.message;
      
      spinner.succeed();

      console.log(chalk.green("\n--- Suggested Message ---"));
      console.log(chalk.cyan(suggestedMessage));
      console.log(chalk.green("-------------------------\n"));

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


program
  .command('run')
  .description('Translate natural language into a Git command.')
  .argument('<string>', 'The task you want to perform (e.g. "squash the last 3 commits')
  .action(async (request) => {
    try {
        const spinner = ora('Fetching the right command...').start();

        const response = await axios.post(
            API_COMMAND_URL, 
            { request },
            { timeout: 30000 }
        );
        const suggestedCommand = response.data.command;

        if (suggestedCommand.startsWith('Error:')) {
            spinner.fail(suggestedCommand);
            process.exit(1);
        }

        spinner.succeed();

        console.log(chalk.yellow.bold('\nWARNING: The suggested command will be executed in your shell.'));
        console.log(chalk.yellow('Always review commands carefully before confirming.\n'));

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
        if (error.response) { 
            console.error(
            chalk.red(`API Error: ${error.response.status} - ${error.response.data.error || 'No message'}`));
        } else { 
            console.error(chalk.red(`An unexpected error occurred: ${error.message}`));
        }

  process.exit(1);
}
  })

program.parse(process.argv);