import test from "node:test";
import assert from "node:assert/strict";
import { scanDiffForSecrets } from "../src/lib/scanner.js";

test("scanner detects private keys", () => {
  const diff = `
+-----BEGIN RSA PRIVATE KEY-----
+MIIEowIBAAKCAQEA0Y...
+-----END RSA PRIVATE KEY-----
  `;
  const result = scanDiffForSecrets(diff);
  assert.equal(result.clean, false);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, "Private Key");
});

test("scanner detects AWS access keys", () => {
  const diff = `
+AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
  `;
  const result = scanDiffForSecrets(diff);
  assert.equal(result.clean, false);
  assert.equal(result.findings[0].rule, "AWS Access Key ID");
  assert.equal(result.findings[0].preview, "AKIA************MPLE");
});

test("scanner detects GitHub tokens", () => {
  const diff = `
+const ghToken = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
  `;
  const result = scanDiffForSecrets(diff);
  assert.equal(result.clean, false);
  assert.equal(result.findings[0].rule, "GitHub Token");
});

test("scanner detects Google API keys", () => {
  const diff = `
+const apiKey = "AIzaSyD-1234567890abcdefghijklmnopqrst";
  `;
  const result = scanDiffForSecrets(diff);
  assert.equal(result.clean, false);
  assert.equal(result.findings[0].rule, "Google API Key");
});

test("scanner allows clean diffs", () => {
  const diff = `
diff --git a/src/index.js b/src/index.js
--- a/src/index.js
+++ b/src/index.js
@@ -1,3 +1,4 @@
+export function hello() {
+  return "world";
+}
  `;
  const result = scanDiffForSecrets(diff);
  assert.equal(result.clean, true);
  assert.equal(result.findings.length, 0);
});

test("scanner is best-effort and does not catch unstructured custom secrets (representative false negatives)", () => {
  // Custom passphrases or unprefixed strings without key-like variable names
  // are outside heuristic regex coverage, which is why the privacy notice warns
  // users that staged diffs are sent to Google Gemini.
  const unstructuredPassphrase = `+const phrase = "correct horse battery staple";`;
  const customInternalCode = `+const fallback = "x9z8q7w6e5r4t3y2u1";`;

  assert.equal(scanDiffForSecrets(unstructuredPassphrase).clean, true);
  assert.equal(scanDiffForSecrets(customInternalCode).clean, true);
});
