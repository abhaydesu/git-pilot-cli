import test from "node:test";
import assert from "node:assert/strict";
import {
  GeminiProvider,
  ProviderError,
  stripFences,
  getGeminiBaseUrl,
  fitsInGeminiRequest,
  boundSummary,
  MAX_DIFF_CHARS,
  MAX_SUMMARY_BYTES,
  OFFICIAL_GEMINI_HOST,
} from "../src/lib/provider.js";

test("stripFences removes markdown code fences and backticks", () => {
  assert.equal(stripFences("```sh\ngit status\n```"), "git status");
  assert.equal(stripFences("`git log`"), "git log");
  assert.equal(stripFences("feat: add login"), "feat: add login");
});

test("getGeminiBaseUrl pins to official Google host and rejects attacker-controlled HTTPS hosts, credentials, queries, and paths", () => {
  assert.equal(getGeminiBaseUrl(""), OFFICIAL_GEMINI_HOST);
  assert.equal(getGeminiBaseUrl("https://generativelanguage.googleapis.com"), OFFICIAL_GEMINI_HOST);

  // Attacker-controlled HTTPS host must be rejected before any request is sent
  assert.throws(
    () => getGeminiBaseUrl("https://attacker.example.com"),
    (err) =>
      err instanceof ProviderError &&
      err.code === "UNTRUSTED_HOST" &&
      /Refusing to send Gemini API key to untrusted host/.test(err.message)
  );

  // Subdomain spoofing must be rejected
  assert.throws(
    () => getGeminiBaseUrl("https://generativelanguage.googleapis.com.evil.com"),
    (err) => err instanceof ProviderError && err.code === "UNTRUSTED_HOST"
  );

  // Embedded URL credentials must be rejected
  assert.throws(
    () => getGeminiBaseUrl("https://user:pass@generativelanguage.googleapis.com"),
    (err) => err instanceof ProviderError && /embedded credentials/.test(err.message)
  );

  // Query strings and fragments must be rejected
  assert.throws(
    () => getGeminiBaseUrl("https://generativelanguage.googleapis.com?key=leak"),
    (err) => err instanceof ProviderError && /query strings/.test(err.message)
  );
  assert.throws(
    () => getGeminiBaseUrl("https://generativelanguage.googleapis.com#frag"),
    (err) => err instanceof ProviderError && /fragments/.test(err.message)
  );

  // Custom paths must be rejected
  assert.throws(
    () => getGeminiBaseUrl("https://generativelanguage.googleapis.com/custom/path"),
    (err) => err instanceof ProviderError && /custom path/.test(err.message)
  );

  // Plain HTTP and loopback overrides must be rejected even if GIT_PILOT_TEST_LOCAL=1 is set
  assert.throws(
    () => getGeminiBaseUrl("http://example.com"),
    (err) => err instanceof ProviderError && /must use https/.test(err.message)
  );
  assert.throws(
    () => getGeminiBaseUrl("http://127.0.0.1:4000"),
    (err) => err instanceof ProviderError && /must use https/.test(err.message)
  );
});

test("GeminiProvider refuses to instantiate or send key when GEMINI_API_URL is an attacker HTTPS host or GIT_PILOT_TEST_LOCAL loopback", () => {
  const oldUrl = process.env.GEMINI_API_URL;
  const oldTestLocal = process.env.GIT_PILOT_TEST_LOCAL;
  try {
    process.env.GEMINI_API_URL = "https://evil-collector.example.org";
    assert.throws(
      () => new GeminiProvider({ apiKey: "AIzaSyPersonalSecretKey1234567890" }),
      (err) => err instanceof ProviderError && err.code === "UNTRUSTED_HOST"
    );

    // Even if GIT_PILOT_TEST_LOCAL=1 is set in the environment, published CLI code must reject loopback overrides
    process.env.GIT_PILOT_TEST_LOCAL = "1";
    process.env.GEMINI_API_URL = "http://127.0.0.1:9999";
    assert.throws(
      () => new GeminiProvider({ apiKey: "AIzaSyPersonalSecretKey1234567890" }),
      (err) => err instanceof ProviderError && err.code === "INVALID_ENDPOINT"
    );
    process.env.GEMINI_API_URL = "https://127.0.0.1:9999";
    assert.throws(
      () => new GeminiProvider({ apiKey: "AIzaSyPersonalSecretKey1234567890" }),
      (err) => err instanceof ProviderError && err.code === "UNTRUSTED_HOST"
    );
  } finally {
    if (oldUrl !== undefined) process.env.GEMINI_API_URL = oldUrl;
    else delete process.env.GEMINI_API_URL;
    if (oldTestLocal !== undefined) process.env.GIT_PILOT_TEST_LOCAL = oldTestLocal;
    else delete process.env.GIT_PILOT_TEST_LOCAL;
  }
});

test("fitsInGeminiRequest and boundSummary enforce UTF-8 serialized byte limits on multi-byte and newline-heavy diffs", () => {
  const small = "a".repeat(1000);
  assert.equal(fitsInGeminiRequest(small, small), true);

  // Over character cap
  const tooManyChars = "a".repeat(MAX_DIFF_CHARS + 1);
  assert.equal(fitsInGeminiRequest(tooManyChars, tooManyChars), false);

  // Under character cap (400,000 < 800,000), but > 1 MB in UTF-8 (3 bytes per '€')
  const multiByte = "€".repeat(400_000);
  assert.ok(multiByte.length < MAX_DIFF_CHARS);
  assert.equal(fitsInGeminiRequest(multiByte, multiByte), false);

  // Under character cap (600,000 < 800,000), but > 1 MB once JSON-escaped ('\n' -> '\\n')
  const newlineHeavy = "\n".repeat(600_000);
  assert.ok(newlineHeavy.length < MAX_DIFF_CHARS);
  assert.equal(fitsInGeminiRequest(newlineHeavy, newlineHeavy), false);

  // Oversized file summary is bounded cleanly under MAX_SUMMARY_BYTES
  const hugeSummary = Array.from(
    { length: 10_000 },
    (_, i) => `M\tsrc/components/deeply/nested/module_${i}/index.tsx`
  ).join("\n");
  assert.ok(Buffer.byteLength(hugeSummary, "utf8") > MAX_SUMMARY_BYTES);

  const bounded = boundSummary(hugeSummary);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") <= MAX_SUMMARY_BYTES);
  assert.match(bounded, /\[file summary truncated due to size\]/);
});

test("GeminiProvider.generate rejects oversized UTF-8 payload before making any network request", async () => {
  let networkCalled = false;
  const mockHttpClient = {
    async post() {
      networkCalled = true;
      return { data: {} };
    },
  };

  const provider = new GeminiProvider({
    apiKey: "test-key",
    httpClient: mockHttpClient,
  });

  const multiBytePrompt = "€".repeat(400_000);
  await assert.rejects(
    async () => {
      await provider.generate(multiBytePrompt);
    },
    (err) => {
      assert.equal(err instanceof ProviderError, true);
      assert.equal(err.code, "PAYLOAD_TOO_LARGE");
      assert.equal(err.status, 413);
      return true;
    }
  );
  assert.equal(networkCalled, false);
});

test("GeminiProvider sends header authentication and handles successful response", async () => {
  let capturedRequest = null;
  const mockHttpClient = {
    async post(url, body, options) {
      capturedRequest = { url, body, options };
      return {
        data: {
          candidates: [
            {
              content: {
                parts: [{ text: "feat: add feature" }],
              },
            },
          ],
        },
      };
    },
  };

  const provider = new GeminiProvider({
    apiKey: "test-gemini-key",
    model: "gemini-2.5-flash",
    httpClient: mockHttpClient,
  });

  const res = await provider.generate("Write a commit");
  assert.equal(res, "feat: add feature");
  assert.equal(capturedRequest.options.headers["x-goog-api-key"], "test-gemini-key");
  assert.ok(capturedRequest.url.includes("gemini-2.5-flash"));
});

test("GeminiProvider classifies invalid key errors correctly", async () => {
  const mockHttpClient = {
    async post() {
      const err = new Error("Request failed with status code 400");
      err.response = {
        status: 400,
        data: { error: { message: "API_KEY_INVALID: key is not valid" } },
      };
      throw err;
    },
  };

  const provider = new GeminiProvider({
    apiKey: "bad-key",
    httpClient: mockHttpClient,
  });

  await assert.rejects(
    async () => {
      await provider.generate("test");
    },
    (err) => {
      assert.equal(err instanceof ProviderError, true);
      assert.equal(err.code, "INVALID_KEY");
      assert.ok(err.message.includes("API key is invalid"));
      return true;
    }
  );
});

test("GeminiProvider explains unavailable models without blaming the API key", async () => {
  const mockHttpClient = {
    async post() {
      const err = new Error("Model not found");
      err.response = {
        status: 404,
        data: { error: { message: "models/gemini-custom is not found" } },
      };
      throw err;
    },
  };
  const provider = new GeminiProvider({
    apiKey: "test-key",
    model: "gemini-custom",
    httpClient: mockHttpClient,
  });

  await assert.rejects(
    () => provider.validateKey(),
    (err) => {
      assert.equal(err.code, "MODEL_NOT_FOUND");
      assert.match(err.message, /unavailable to this API key or Google project/);
      assert.match(err.message, /change the "model" value in your Git Pilot config/);
      assert.match(err.message, /git pilot setup/);
      assert.equal(err.message.includes("test-key"), false);
      return true;
    }
  );
});

test("GeminiProvider classifies quota errors correctly", async () => {
  const mockHttpClient = {
    async post() {
      const err = new Error("Rate limit");
      err.response = {
        status: 429,
        data: { error: { message: "RESOURCE_EXHAUSTED" } },
      };
      throw err;
    },
  };

  const provider = new GeminiProvider({
    apiKey: "quota-key",
    httpClient: mockHttpClient,
  });

  await assert.rejects(
    async () => {
      await provider.generate("test");
    },
    (err) => {
      assert.equal(err instanceof ProviderError, true);
      assert.equal(err.code, "QUOTA_EXCEEDED");
      return true;
    }
  );
});

test("GeminiProvider validateKey sends minimal test request", async () => {
  let capturedBody = null;
  const mockHttpClient = {
    async post(url, body) {
      capturedBody = body;
      return {
        data: { candidates: [{ content: { parts: [{ text: "pong" }] } }] },
      };
    },
  };

  const provider = new GeminiProvider({
    apiKey: "valid-key",
    httpClient: mockHttpClient,
  });

  const valid = await provider.validateKey();
  assert.deepEqual(valid, { valid: true });
  assert.equal(capturedBody.contents[0].parts[0].text, "ping");
  assert.equal(capturedBody.generationConfig.maxOutputTokens, 1);
});

test("legacy hosted proxy client (src/lib/api.js) is removed from the CLI package", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(fs.existsSync(path.join(rootDir, "src", "lib", "api.js")), false);
});
