import { parse } from "shell-quote";
import { execa } from "execa";

export class UnsafeCommandError extends Error {}

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
  return tokens.slice(1);
}

/** Runs `git <args>` with the terminal attached. */
export const runGit = (args) => execa("git", args, { stdio: "inherit" });
