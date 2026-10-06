import { Command } from "commander";
import { readFileSync } from "node:fs";
import { commitCommand } from "./commands/commit.js";
import { runCommand } from "./commands/run.js";
import { undoCommand } from "./commands/undo.js";
import { branchCommand } from "./commands/branch.js";
import { setupCommand } from "./commands/setup.js";
import { authStatusCommand, authRemoveCommand } from "./commands/auth.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const SUBCOMMANDS = new Set(["commit", "run", "undo", "branch", "setup", "auth", "help"]);

const GLOBAL_FLAGS = new Set(["-h", "--help", "-V", "--version"]);
const COMMIT_FLAGS = new Set(["-m", "--message-context", "--dry-run", "--accept-notice"]);

function isKnownCommitFlag(arg) {
  return COMMIT_FLAGS.has(arg) || arg.startsWith("--message-context=") || arg.startsWith("-m=");
}

/**
 * Combines `-m/--message-context` and any remaining positional intent words
 * so multi-word unquoted `-m add login throttling` never drops words.
 */
export function extractCommitIntent(intentParts, options = {}) {
  const parts = [];
  if (typeof options.messageContext === "string" && options.messageContext.trim()) {
    parts.push(options.messageContext.trim());
  }

  if (Array.isArray(intentParts)) {
    for (const part of intentParts) {
      if (typeof part === "string" && part.trim()) {
        parts.push(part.trim());
      }
    }
  } else if (typeof intentParts === "string" && intentParts.trim()) {
    parts.push(intentParts.trim());
  }

  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Normalizes CLI argv so bare `git pilot`, `git pilot add login throttling`,
 * or `git pilot -m add login throttling` dispatches directly to `commit`.
 * Unknown flags (e.g. `--unknown`) are left untouched so Commander reports an error.
 */
export function normalizeArgs(argv) {
  const [nodeBin, script, ...rest] = argv;
  if (!rest || rest.length === 0) {
    return [nodeBin, script, "commit"];
  }

  const firstArg = rest[0];
  if (GLOBAL_FLAGS.has(firstArg) || SUBCOMMANDS.has(firstArg)) {
    return argv;
  }

  // If the first argument is an unknown flag, let Commander reject it with help
  if (firstArg.startsWith("-") && !isKnownCommitFlag(firstArg)) {
    return argv;
  }

  // Preserve individual tokens so flags like -m and --dry-run are parsed by `commit`
  // and all remaining positional tokens are joined by extractCommitIntent.
  return [nodeBin, script, "commit", ...rest];
}

export function buildProgram({
  handlers = {
    commit: commitCommand,
    setup: setupCommand,
    authStatus: authStatusCommand,
    authRemove: authRemoveCommand,
    run: runCommand,
    undo: undoCommand,
    branch: branchCommand,
  },
} = {}) {
  const program = new Command()
    .name("git-pilot")
    .description("A local-first AI Git assistant in your command line.")
    .version(version);

  program
    .command("commit")
    .description("Generate an AI-powered commit message from staged changes.")
    .argument("[intent...]", 'Optional intent for the commit (e.g., "add a new feature")')
    .option("-m, --message-context <context>", "Provide context for the commit message")
    .option("--dry-run", "Output only the generated message to stdout without committing")
    .option(
      "--accept-notice",
      "Explicitly acknowledge sending staged diffs to Google Gemini for non-interactive runs"
    )
    .action(async (intentParts, options) => {
      const intent = extractCommitIntent(intentParts, options);
      await handlers.commit(intent, options);
    });

  program
    .command("setup")
    .description("Guided interactive setup for your Google Gemini API key.")
    .action(handlers.setup);

  const auth = program.command("auth").description("Inspect or manage stored AI credentials.");

  auth
    .command("status")
    .description("Check credential storage and API key status.")
    .action(handlers.authStatus);

  auth
    .command("remove")
    .description("Remove stored API key from the local OS credential manager.")
    .action(handlers.authRemove);

  program
    .command("run")
    .description("Translate natural language into a Git command.")
    .argument("<string>", 'The task you want to perform (e.g. "squash the last 3 commits")')
    .action(handlers.run);

  program
    .command("undo")
    .description("Suggests a command to undo your last major Git action.")
    .action(handlers.undo);

  program
    .command("branch")
    .description("Generates a conventional branch name from a description and creates the branch.")
    .argument("<string>", 'A description of the branch\'s purpose (e.g., "fix login bug")')
    .action(handlers.branch);

  return program;
}
