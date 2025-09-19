<div align="center" display="inline">
  <img width="30" height="30" alt="logo" src="./public/logo-pilot.png" />
</div>
# Git Pilot 

[![NPM Version](https://img.shields.io/npm/v/@abhaydesu/git-pilot)](https://www.npmjs.com/package/@abhaydesu/git-pilot)

An AI-powered assistant that lives in your command line to streamline your Git workflow.


## ◼️ The Problem
Remembering complex commands like interactive rebase can be a pain. Writing well-formatted commit messages is a chore. Git is powerful, but its interface can sometimes get in the way of a fast workflow.

**Git Pilot** solves this by acting as your intelligent copilot, translating your natural language intent into the exact commands and messages you need.

## ◼️ Features
* **Natural Language to Git Command:** Translate plain English requests like "squash the last 3 commits" into the precise Git command (`git rebase -i HEAD~3`).
* **AI-Powered Commit Messages:** Analyzes your staged changes (`git diff`) and generates a perfect commit message following the Conventional Commits specification.

* **Interactive & Safe:** Always asks for your confirmation before executing any command, ensuring you're always in control.

## ◼️ Installation
Make sure you have Node.js (v18+) and Git installed. Then, run the following command to install Git Pilot globally:

```bash
npm install -g @abhaydesu/git-pilot
```

### ◾ Usage

#### **Running a Git Command**
Run the run command with the task you want to perform in quotes.

```Bash

git pilot run "create a new branch called feature/auth" 
```
The tool will suggest the correct Git command and ask for confirmation before executing it.


#### **Generating a Commit Message**
Stage your files (git add .).

Run the commit command with your intent in quotes.

```Bash

git pilot commit "add new user profile page"
```
The tool will suggest a message and ask for confirmation before committing.



### ◾ How It Works
Git Pilot is a CLI tool that communicates with a secure backend API. This API uses Google's Gemini models to understand your intent and analyze code, keeping your API keys safe and off your local machine.

### ◾ License
This project is licensed under the MIT License.