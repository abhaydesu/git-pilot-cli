// In-process mock HTTP client for Gemini API so PTY e2e tests need no external network,
// no real Gemini key, no local TCP socket bind (EPERM-safe), and no env URL override in production code.
// Loaded in e2e tests via: node --import ./test/e2e/fake-api.mjs bin/git-pilot.js ...
import { setDefaultHttpClientForTesting } from "../../src/lib/provider.js";

const RUN_REPLIES = {
  "show status": "git status",
  quoted: 'git commit --allow-empty -m "two words"',
  evil: "git status; touch PWNED",
  notgit: "rm -rf important",
  dashc: "git -c core.pager=evil log",
  rebasex: "git rebase -x 'touch PWNED' HEAD~1",
  badresp: null,
};

function extractTag(text, tag) {
  const m = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i").exec(text);
  return m ? m[1].trim() : "";
}

function handleGeminiRequest(url, body, options = {}) {
  const headers = options.headers || {};
  const apiKey = headers["x-goog-api-key"] || headers["X-Goog-Api-Key"];
  if (!apiKey) {
    return [401, { error: { message: "API_KEY_INVALID: missing header" } }];
  }

  const prompt = body?.contents?.[0]?.parts?.[0]?.text || "";

  if (prompt === "ping") {
    return [200, { candidates: [{ content: { parts: [{ text: "pong" }] } }] }];
  }

  if (prompt.includes("Conventional Commits specification")) {
    return [200, { candidates: [{ content: { parts: [{ text: "feat: add b" }] } }] }];
  }

  if (prompt.includes("Translate the user's request")) {
    const request = extractTag(prompt, "request");
    if (request === "boom") {
      return [500, { error: { message: "Internal Gemini server error." } }];
    }
    if (request === "badresp") {
      return [200, { candidates: [] }];
    }
    const reply = RUN_REPLIES[request] ?? "git status";
    return [200, { candidates: [{ content: { parts: [{ text: reply }] } }] }];
  }

  if (prompt.includes("conventional Git branch names")) {
    return [200, { candidates: [{ content: { parts: [{ text: "feat/test-branch" }] } }] }];
  }

  return [200, { candidates: [{ content: { parts: [{ text: "git status" }] } }] }];
}

setDefaultHttpClientForTesting({
  async post(url, body, options) {
    const [status, data] = handleGeminiRequest(url, body, options);
    if (status >= 400) {
      const err = new Error(`Request failed with status code ${status}`);
      err.response = { status, data };
      throw err;
    }
    return { status, data };
  },
});
