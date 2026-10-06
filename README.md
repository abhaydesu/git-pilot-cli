<div align="center" display="inline">
  <img width="40" height="40" alt="logo" src="./public/logo.png" />
</div>

# Git Pilot

[![NPM Version](https://img.shields.io/npm/v/@abhaydesu/git-pilot)](https://www.npmjs.com/package/@abhaydesu/git-pilot)

A local-first, AI-powered Git assistant that lives in your command line. Never write a commit message from scratch or look up a complex Git command again.

---

## Features

- **Frictionless Commit Fast Path:** Simply run `git pilot` (or `git pilot commit`) with staged changes. It analyzes your staged diff and suggests a conventional commit message.
- **Bare Intent & Context Support:** Add optional intent without ceremony: `git pilot add auth throttling` or `git pilot -m "fix login bug"` (unquoted multi-word `-m add auth throttling` is also supported).
- **Scriptable Dry-Run Mode:** `git pilot --dry-run` sends spinners and warnings to `stderr` and writes only the generated commit message to `stdout`.
- **Personal Key & Local Execution:** Connects directly to Google Gemini (`https://generativelanguage.googleapis.com`) using your personal API key. Git Pilot's hosted servers are never in the request path.
- **OS Credential Manager Storage:** Your API key is stored locally in your operating system's native credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service) without exposing secrets in process arguments.
- **Best-Effort Pre-flight Secret Screening:** Staged diffs are screened locally for common high-confidence credential patterns (such as private keys, AWS access keys, GitHub tokens, Slack tokens, and Google API keys) before transmission.
- **Best-Effort Index Modification Detection:** Checks your staged Git index tree hash (`git write-tree`) before generation and immediately before invoking `git commit` to detect concurrent staging changes.
- **Natural Language to Git Commands:** Translate plain English requests like "squash the last 3 commits" into precise Git commands with `git pilot run <query>`.
- **Safe Undo:** `git pilot undo` parses the structured action field of your latest reflog entry and checks live repository state before suggesting an undo command.
- **Intelligent Branching:** Describe your goal, and `git pilot branch` generates a clean, conventional branch name.
- **Safe Subprocess Execution:** Commands are validated against an allowlist and executed via `execa` using direct `argv` arrays (never through a shell). Provider API keys are stripped from the environment of all Git subprocesses and hooks, and diff collection disables external diff and textconv helpers (`--no-ext-diff --no-textconv`).

## Installation

Requires Node.js (v20+) and Git. Install Git Pilot globally via npm:

```bash
npm install -g @abhaydesu/git-pilot
```

## First-Run Setup

On your first `git pilot` run with staged changes, Git Pilot starts guided setup if it does not find an API key. You can also start it directly:

```bash
git pilot setup
```

Setup shows the provider, selected model, and the data sent before asking for consent. Enter your Gemini API key at the masked prompt. Git Pilot validates the key and model with Google before saving the key to your OS credential manager; if validation fails, the key is not saved. The CLI currently defaults to `gemini-3.5-flash-lite`.

Get a Gemini API key at [Google AI Studio](https://aistudio.google.com/app/apikey). Model availability depends on your Google project. Google currently limits access to Gemini 2.5 models for many new projects; if setup reports that a model is unavailable, check model access in Google AI Studio or set `model` in your Git Pilot config to a model available to your key, then run `git pilot setup` again. Config is stored at `~/.config/git-pilot/config.json` on macOS/Linux, or `%APPDATA%\git-pilot\config.json` on Windows. The previous built-in model is migrated automatically when an older config is loaded.

To inspect or remove your stored credentials at any time:

```bash
git pilot auth status
git pilot auth remove
```

## Usage

### Generating a Commit Message (Fast Path)

Stage your changes (`git add <files>`), then run `git pilot`:

```bash
# Analyze staged diff automatically
git pilot

# Provide intent as bare words (no `commit` subcommand needed)
git pilot add user profile page

# Or use -m / --message-context
git pilot -m "add user profile page"

# Output only the message to stdout without committing
git pilot --dry-run
```

After generation, an interactive menu (defaulting to **Abort** so pressing Enter accidentally never creates an unintended commit) allows you to:

1. **Accept and commit:** Commits the staged changes using `git commit -m`.
2. **Edit in $EDITOR:** Opens your configured editor to modify the message.
3. **Regenerate message:** Asks Gemini for another suggestion.
4. **Abort:** Cancels without modifying your Git repository.

Google receives each staged diff and intent sent for generation directly from the CLI. Calls use your Gemini API quota and follow your Google AI plan's limits and pricing. See Google's [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

### Running a Git Command

```bash
git pilot run "cherry-pick the last commit from main"
```

### Creating a Conventional Branch

```bash
git pilot branch "create a new feature for the auth system"
```

### Undoing a Mistake

```bash
git pilot undo
```

## Privacy & Security Model

- **Credential Storage & Transport:** The API key is stored locally in your operating system credential manager (macOS Keychain, Windows Credential Manager, Linux Secret Service). When making an AI request, your key is transmitted directly over TLS to Google's official Gemini endpoint (`https://generativelanguage.googleapis.com`) in the `x-goog-api-key` header; Git Pilot's hosted servers never receive your API key or repository diffs in personal-key mode.
- **Data Sent to Provider:** Only the staged diff (or a bounded file-status summary for diffs exceeding 800,000 characters or 1 MB UTF-8 JSON size) and optional user intent are transmitted when generating commit messages. Untracked and unstaged files are never read or sent. Before the first provider request, Git Pilot requires acknowledging a versioned data-sharing notice regardless of whether the key is stored in the OS credential manager or supplied via `GEMINI_API_KEY`. Provider data retention and model training terms are governed by Google's [Gemini API Terms of Service](https://ai.google.dev/terms).
- **Best-Effort Secret Screening:** Before sending any diff, Git Pilot screens staged changes for common high-confidence credential patterns. This heuristic screening is a best-effort safeguard and **cannot guarantee that a diff is free of all secrets or proprietary data**—always review staged changes before running `git pilot`.
- **Git Subprocess & Hook Isolation:** Git Pilot strips `GEMINI_API_KEY` and other provider secret variables from the environment of every Git subprocess (including `git commit` hooks) and passes `--no-ext-diff --no-textconv` whenever collecting diffs.
- **Index Modification Check:** Git Pilot records `git write-tree` before calling the provider and re-checks it immediately before invoking `git commit`. This provides best-effort detection if files were staged or unstaged while reviewing the proposal.

## Configuration & Environment Variables

| Variable         | Description                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY` | Optional ephemeral override for CI/headless environments. Takes precedence over (and shadows) the OS credential store without persisting to disk. `git pilot auth status` and `git pilot auth remove` distinguish between environment and OS-stored credentials. |
| `NO_COLOR`       | Disables ANSI color codes in terminal output (complies with [no-color.org](https://no-color.org)).                                                                                                                                                               |

Non-secret configuration is saved in your platform's standard configuration directory (`~/.config/git-pilot/config.json` on POSIX systems with restrictive `0600` permissions).

## Development

```bash
git clone https://github.com/abhaydesu/git-pilot-cli.git
cd git-pilot-cli
npm install
npm test            # Run unit tests
npm run test:e2e    # Run end-to-end PTY tests (requires expect)
npm run lint        # Run ESLint
npm run format      # Format with Prettier
```

## License

MIT License.
