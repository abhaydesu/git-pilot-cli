import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  apiBaseUrl,
  describeError,
  fitsInRequest,
  requireString,
  DEFAULT_API_URL,
  MAX_DIFF_CHARS,
} from "../src/lib/api.js";

afterEach(() => delete process.env.GIT_PILOT_API_URL);

test("uses the hosted API by default", () => {
  assert.equal(apiBaseUrl(), DEFAULT_API_URL);
});

test("GIT_PILOT_API_URL overrides the base URL and trailing slashes are dropped", () => {
  process.env.GIT_PILOT_API_URL = "http://localhost:3000//";
  assert.equal(apiBaseUrl(), "http://localhost:3000");
});

test("describeError formats API errors with status and message", () => {
  const error = { response: { status: 400, data: { error: '"diff" is required.' } } };
  assert.equal(describeError(error), 'API Error: 400 - "diff" is required.');
});

test("describeError handles API errors without a body message", () => {
  assert.equal(
    describeError({ response: { status: 502, data: "" } }),
    "API Error: 502 - No message"
  );
});

test("describeError handles network errors", () => {
  assert.equal(
    describeError(new Error("connect ECONNREFUSED")),
    "An unexpected error occurred: connect ECONNREFUSED"
  );
});

test("plain http is allowed only for localhost", () => {
  for (const ok of [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://api.example.com",
  ]) {
    process.env.GIT_PILOT_API_URL = ok;
    assert.equal(apiBaseUrl(), ok);
  }
  for (const bad of [
    "http://example.com",
    "http://localhost.evil.com",
    "ftp://x.com",
    "file:///etc/passwd",
  ]) {
    process.env.GIT_PILOT_API_URL = bad;
    assert.throws(() => apiBaseUrl(), /must use https/);
  }
});

test("an invalid GIT_PILOT_API_URL is reported", () => {
  process.env.GIT_PILOT_API_URL = "not a url";
  assert.throws(() => apiBaseUrl(), /not a valid URL/);
});

test("requireString accepts strings and rejects everything else", () => {
  assert.equal(requireString({ a: "x" }, "a"), "x");
  for (const data of [null, undefined, {}, { a: "" }, { a: 5 }, { a: { b: 1 } }, "str"]) {
    assert.throws(() => requireString(data, "a"), /Unexpected response from the API/);
  }
});

test("fitsInRequest counts characters and encoded bytes", () => {
  const small = "a".repeat(1000);
  assert.equal(fitsInRequest({ diff: small }, small), true);

  const tooManyChars = "a".repeat(MAX_DIFF_CHARS + 1);
  assert.equal(fitsInRequest({ diff: tooManyChars }, tooManyChars), false);

  // Under the character cap, but > 1 MB once JSON-escaped (every newline becomes \n).
  const escapeHeavy = "\n".repeat(600_000);
  assert.ok(escapeHeavy.length <= MAX_DIFF_CHARS);
  assert.equal(fitsInRequest({ diff: escapeHeavy }, escapeHeavy), false);

  // Under the character cap, but > 1 MB in UTF-8 (3 bytes per character).
  const multiByte = "€".repeat(400_000);
  assert.equal(fitsInRequest({ diff: multiByte }, multiByte), false);
});
