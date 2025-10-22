<div align="center" display="inline">
  <img width="40" height="40" alt="logo" src="./public/logo-dark-new.png" />
</div>

# Git Pilot 

[![NPM Version](https://img.shields.io/npm/v/@abhaydesu/git-pilot)](https://www.npmjs.com/package/@abhaydesu/git-pilot)

An AI-powered assistant that lives in your command line to streamline your Git workflow. Never write a commit message or look up a command again.

---

## The Problem
Remembering complex commands like interactive rebase can be a pain. Writing well-formatted commit messages is a chore. Git is powerful, but its interface can sometimes get in the way of a fast workflow.

**Git Pilot** solves this by acting as your intelligent copilot, translating your natural language intent into the exact commands and messages you need.

## Features
* **AI-Powered Commit Messages:** Analyzes your staged changes (`git diff`) and generates a perfect commit message following the Conventional Commits specification. Just run `git pilot commit <your_intent>`
* **Natural Language to Git Command:** Translate plain English requests like "squash the last 3 commits" into the precise Git command. One simple `git pilot run <your_request>`
* **Magic Undo:** Made a mistake? `git pilot undo` analyzes your recent history and suggests the exact command to reverse your last action.
* **Intelligent Branching:** Describe your goal, and `git pilot branch` will create a clean, conventional branch name for you.
* **Interactive & Safe:** Always asks for your confirmation before executing any command. You can also **edit** any AI suggestion to get it just right.

## Installation
Make sure you have Node.js (v18+) and Git installed. Then, run the following command to install Git Pilot globally:

```bash
npm install -g @abhaydesu/git-pilot
```

### ◾ Usage

#### *Generating a Commit Message*
Stage your files (git add .), then run git pilot commit. This command analyzes your staged changes and generates a conventional commit message.

##### With an Intent
Provide a brief description of your changes, and the AI will use it to write the commit message.

```Bash

git pilot commit "add new user profile page"
```

##### Without an Intent
If you don't provide an intent, the AI will analyze the diff of your staged files and generate a message automatically.

```Bash

git pilot commit
```
After running, you can accept, edit, or abort the suggested commit.


#### *Running a Git Command*
Run the run command with the task you want to perform. The tool will suggest a command and ask for confirmation.

```Bash

git pilot run "cherry-pick the last commit from the main branch" 
```

#### *Creating a New Branch*
Describe the purpose of your new branch, and let the AI generate a conventional name.

```Bash

git pilot branch "create a new feature for the auth system"
```

#### *Undoing a Mistake*

If you've made a mistake (like a bad commit or merge), this command will analyze your history and suggest the safest way to undo it.

```Bash

git pilot undo 
```

### ◾ How It Works
Git Pilot is a CLI tool that communicates with a secure backend API. This API uses Google's Gemini models to understand your intent and analyze code, keeping your API keys safe and off your local machine.

### ◾ License
This project is licensed under the MIT License.