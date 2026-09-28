import { parse } from "shell-quote";
import { execa } from "execa";

export class UnsafeCommandError extends Error {}

// Mirrors the API's allowlist. The CLI re-checks it because the API (or a custom
// GIT_PILOT_API_URL) is an untrusted source of commands. This also rejects leading
// global options such as `git -c core.sshCommand=... fetch`.
const ALLOWED_SUBCOMMANDS = new Set([
  "add",
  "branch",
  "checkout",
  "cherry-pick",
  "clone",
  "commit",
  "diff",
  "fetch",
  "log",
  "merge",
  "pull",
  "push",
  "rebase",
  "reflog",
  "reset",
  "restore",
  "revert",
  "show",
  "stash",
  "status",
  "switch",
  "tag",
]);

// Options that make git run another program or write to an arbitrary path.
const FORBIDDEN_OPTION = /^--(upload-pack|receive-pack|exec|exec-path|output)(=|$)/;

function assertSafeArgs(args) {
  const [subcommand, ...rest] = args;
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new UnsafeCommandError(`"${subcommand}" is not an allowed git subcommand.`);
  }

  for (const arg of rest) {
    if (arg === "--") break; // everything after is a path, not an option
    if (
      FORBIDDEN_OPTION.test(arg) ||
      (subcommand === "rebase" && arg.startsWith("-x")) || // -x = --exec
      (subcommand === "clone" && arg.startsWith("-u")) // -u = --upload-pack
    ) {
      throw new UnsafeCommandError(`The option "${arg}" is not allowed.`);
    }
  }
}

/**
 * Turns a suggested command string into an argv array for `git`, or throws.
 * Only plain `git <args...>` is accepted: quoting is honored, but shell
 * operators (;, &&, |, >, $(...)), comments and non-git binaries are rejected.
 * Nothing is ever run through a shell.
 */
export function parseGitCommand(command) {
  // Keep `$VAR` literal instead of letting shell-quote expand it to "".
  const tokens = parse(command, (key) => `$${key}`).map((token) =>
    // Globs (`git add *.js`) are valid pathspecs that git expands itself.
    typeof token === "object" && token.op === "glob" ? token.pattern : token
  );

  if (tokens.length === 0) {
    throw new UnsafeCommandError("The suggested command is empty.");
  }
  if (tokens.some((token) => typeof token !== "string")) {
    throw new UnsafeCommandError(
      "The suggested command contains shell operators, which are not allowed."
    );
  }
  if (tokens[0] !== "git" || tokens.length < 2) {
    throw new UnsafeCommandError("Only git commands can be executed.");
  }
  const args = tokens.slice(1);
  assertSafeArgs(args);
  return args;
}

/** Runs `git <args>` with the terminal attached. */
export const runGit = (args) => execa("git", args, { stdio: "inherit" });
