<div align="center" display="inline">
  <img width="30" height="30" alt="logo" src="./public/logo-pilot.png" />
</div>

# Git Pilot API

This is the backend API server that powers the <a href="https://www.npmjs.com/package/@abhaydesu/git-pilot">`git-pilot`</a> CLI tool. It handles the secure communication with AI models to generate Git commands, commit messages, undo actions, and branch names.

## ◼️ Purpose

The primary role of this API is to act as a secure intermediary between the <a href="https://github.com/abhaydesu/git-pilot-cli">`git-pilot-cli` </a> and the AI service (Google Gemini). This architecture ensures that the AI API keys are never exposed on a user's local machine.

## ◼️ Technology Stack

* **Runtime:** Node.js
* **Framework:** Express.js
* **AI Service:** Google Gemini API
* **Deployment:** Vercel

## ◼️ API Endpoints

The API exposes the following endpoints:

### 1. Generate Commit Message

* **Route:** `POST /api/pilot-commit`
* **Description:** Analyzes a Git diff and a user's intent to generate a conventional commit message.
* **Request Body (JSON):**

  ```json
  {
    "intent": "string",
    "diff": "string"
  }
  ```
* **Success Response (200 - JSON):**

  ```json
  {
    "message": "string"
  }
  ```

### 2. Generate Git Command

* **Route:** `POST /api/pilot-run`
* **Description:** Translates a user's natural language request into an executable, safe Git command.
* **Request Body (JSON):**

  ```json
  {
    "request": "string"
  }
  ```
* **Success Response (200 - JSON):**

  ```json
  {
    "command": "string"
  }
  ```

### 3. Undo Last Action

* **Route:** `POST /api/pilot-undo`
* **Description:** Suggests a safe Git command to undo the most recent significant action (merge, rebase, commit).
* **Request Body (JSON):**

  ```json
  {
    "reflog": "string"
  }
  ```
* **Success Response (200 - JSON):**

  ```json
  {
    "command": "string",
    "explanation": "string"
  }
  ```

### 4. Generate Branch Name

* **Route:** `POST /api/pilot-branch`
* **Description:** Converts a natural language description into a conventional, kebab-case Git branch name.
* **Request Body (JSON):**

  ```json
  {
    "description": "string"
  }
  ```
* **Success Response (200 - JSON):**

  ```json
  {
    "branchName": "string"
  }
  ```

### ◾ Deployment

This API is designed for and deployed on Vercel.
