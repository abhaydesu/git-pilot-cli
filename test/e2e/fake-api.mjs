// Minimal stand-in for git-pilot-api, so e2e tests need no network or Gemini key.
// Usage: node fake-api.mjs <port-file>   (writes the chosen port to <port-file>)
import http from "node:http";
import fs from "node:fs";

const RUN_REPLIES = {
  "show status": "git status",
  quoted: 'git commit --allow-empty -m "two words"',
  evil: "git status; touch PWNED",
  notgit: "rm -rf important",
  dashc: "git -c core.pager=evil log",
  rebasex: "git rebase -x 'touch PWNED' HEAD~1",
  badresp: null,
};

const handlers = {
  "pilot-run": ({ request }) => {
    if (request === "boom") return [500, { error: "Internal server error." }];
    if (request === "badresp") return [200, { nothing: true }];
    return [200, { command: RUN_REPLIES[request] ?? "git status" }];
  },
  "pilot-undo": () => [
    200,
    { command: "git reset --soft HEAD~1", explanation: "Undoes the last commit." },
  ],
  "pilot-branch": () => [200, { branchName: "feat/Test Branch" }],
  "pilot-commit": () => [200, { message: "feat: add b" }],
};

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const handler = handlers[req.url.replace(/^\/api\//, "")];
    const [status, body] = handler
      ? handler(JSON.parse(raw || "{}"))
      : [404, { error: "Not found." }];
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
});

server.listen(0, "127.0.0.1", () =>
  fs.writeFileSync(process.argv[2], String(server.address().port))
);
