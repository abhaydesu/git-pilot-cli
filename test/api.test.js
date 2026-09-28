import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiBaseUrl, describeError, DEFAULT_API_URL } from "../src/lib/api.js";

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
