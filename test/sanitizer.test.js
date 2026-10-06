import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeTerminalText,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_LINES,
} from "../src/lib/sanitizer.js";

test("strips ANSI escape codes and OSC sequences", () => {
  const maliciousAnsi = "\u001b[31mRed text\u001b[0m and \u001b]0;Title\u0007payload";
  const cleaned = sanitizeTerminalText(maliciousAnsi);
  assert.equal(cleaned, "Red text and payload");
});

test("strips non-printable control characters but preserves newlines", () => {
  const input = "Hello\u0000\u0007\u0008World\nLine 2";
  const cleaned = sanitizeTerminalText(input);
  assert.equal(cleaned, "HelloWorld\nLine 2");
});

test("caps message length and lines", () => {
  const longText = "a".repeat(MAX_MESSAGE_CHARS + 100);
  const truncated = sanitizeTerminalText(longText);
  assert.ok(truncated.includes("...[output truncated for safety]"));
  assert.ok(truncated.length <= MAX_MESSAGE_CHARS + 50);

  const manyLines = Array(MAX_MESSAGE_LINES + 20)
    .fill("line")
    .join("\n");
  const truncatedLines = sanitizeTerminalText(manyLines);
  assert.ok(truncatedLines.includes("...[output truncated for safety]"));
});
