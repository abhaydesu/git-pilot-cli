import { Command } from "commander";
import { readFileSync } from "node:fs";
import { commitCommand } from "./commands/commit.js";
import { runCommand } from "./commands/run.js";
import { undoCommand } from "./commands/undo.js";
import { branchCommand } from "./commands/branch.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export function buildProgram() {
  const program = new Command()
    .name("git-pilot")
    .description("An AI-powered Git assistant in your command line.")
    .version(version);

  program
    .command("commit")
    .description("Generate an AI-powered commit message.")
    .argument("[intent]", 'Optional: The user\'s intent for the commit (e.g., "add a new feature")')
    .action(commitCommand);

  program
    .command("run")
    .description("Translate natural language into a Git command.")
    .argument("<string>", 'The task you want to perform (e.g. "squash the last 3 commits")')
    .action(runCommand);

  program
    .command("undo")
    .description("Suggests a command to undo your last major Git action")
    .action(undoCommand);

  program
    .command("branch")
    .description("Generates a conventional branch name from a description and creates the branch.")
    .argument("<string>", 'A description of the branch\'s purpose (e.g., "fix login bug")')
    .action(branchCommand);

  return program;
}
