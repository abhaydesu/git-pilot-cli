import axios from "axios";
import process from "node:process";
import { sanitizeTerminalText } from "./sanitizer.js";
import { redactSecretText } from "./credentials.js";

export const OFFICIAL_GEMINI_HOST = "https://generativelanguage.googleapis.com";
export const OFFICIAL_GEMINI_HOSTNAME = "generativelanguage.googleapis.com";
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_CONTENT_LENGTH = 1_000_000;
export const MAX_REQUEST_BYTES = 1_000_000;
export const MAX_DIFF_CHARS = 800_000;
export const MAX_SUMMARY_BYTES = 200_000;

const SAFE_MODEL_REGEX = /^[a-zA-Z0-9._-]+$/;

let defaultHttpClientOverride = null;

/**
 * Allows test suites to inject an in-process mock HTTP client without exposing
 * any environment-variable endpoint override in published CLI code.
 */
export function setDefaultHttpClientForTesting(client) {
  defaultHttpClientOverride = client || null;
}

export class ProviderError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Validates and resolves the Gemini API base URL.
 * Strictly pins the hostname to generativelanguage.googleapis.com over HTTPS,
 * and rejects embedded credentials, query strings, fragments, custom paths, and local overrides.
 */
export function getGeminiBaseUrl(rawOverride = process.env.GEMINI_API_URL) {
  const raw = rawOverride || OFFICIAL_GEMINI_HOST;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError(
      `Invalid provider URL: ${sanitizeTerminalText(String(raw))}`,
      "INVALID_ENDPOINT"
    );
  }

  if (url.username || url.password) {
    throw new ProviderError(
      "Provider URL must not contain embedded credentials.",
      "INVALID_ENDPOINT"
    );
  }

  if (url.search || url.hash) {
    throw new ProviderError(
      "Provider URL must not contain query strings or fragments.",
      "INVALID_ENDPOINT"
    );
  }

  if (url.pathname && url.pathname !== "/") {
    throw new ProviderError(
      "Provider base URL must not include a custom path.",
      "INVALID_ENDPOINT"
    );
  }

  if (url.protocol !== "https:") {
    throw new ProviderError("GEMINI_API_URL must use https.", "INVALID_ENDPOINT");
  }

  if (url.hostname !== OFFICIAL_GEMINI_HOSTNAME) {
    throw new ProviderError(
      `Refusing to send Gemini API key to untrusted host "${sanitizeTerminalText(url.hostname)}". ` +
        `Personal keys are only transmitted to ${OFFICIAL_GEMINI_HOSTNAME}.`,
      "UNTRUSTED_HOST"
    );
  }

  if (url.port && url.port !== "443") {
    throw new ProviderError(
      `Refusing to connect to non-standard port "${url.port}" on ${OFFICIAL_GEMINI_HOSTNAME}.`,
      "INVALID_ENDPOINT"
    );
  }

  return `${url.protocol}//${url.host}`;
}

export function buildGeminiRequestBody(prompt) {
  return {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  };
}

/**
 * Checks that both the character length of `rawDiff` and the UTF-8 byte length
 * of the JSON-serialized Gemini request body are within safe limits.
 */
export function fitsInGeminiRequest(prompt, rawDiff = "") {
  if (rawDiff && rawDiff.length > MAX_DIFF_CHARS) {
    return false;
  }
  const body = buildGeminiRequestBody(prompt);
  const encodedBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  return encodedBytes <= MAX_REQUEST_BYTES;
}

/**
 * Bounds a file-status summary so its UTF-8 JSON-escaped byte size never exceeds `maxBytes`.
 */
export function boundSummary(summaryText, maxBytes = MAX_SUMMARY_BYTES) {
  if (typeof summaryText !== "string" || !summaryText) return "";
  if (Buffer.byteLength(JSON.stringify(summaryText), "utf8") <= maxBytes) {
    return summaryText;
  }

  const lines = summaryText.split("\n");
  const kept = [];
  let currentBytes = 0;
  const suffix = "\n... [file summary truncated due to size]";
  const budget = Math.max(256, maxBytes - Buffer.byteLength(suffix, "utf8") - 64);

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(JSON.stringify(line + "\n"), "utf8");
    if (currentBytes + lineBytes > budget) {
      break;
    }
    kept.push(line);
    currentBytes += lineBytes;
  }

  if (kept.length === 0) {
    return summaryText.slice(0, Math.floor(budget / 4)) + suffix;
  }

  return kept.join("\n") + suffix;
}

/** Strips code fences, quotes, and backticks */
export function stripFences(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/^```\w*\n?/, "")
    .replace(/\n?```$/, "")
    .replace(/^`|`$/g, "")
    .trim();
}

/**
 * Direct client for Google Gemini REST API.
 * Uses x-goog-api-key header over HTTPS directly to Google.
 */
export class GeminiProvider {
  constructor({ apiKey, model = DEFAULT_MODEL, httpClient = null } = {}) {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      throw new Error("API key is required for GeminiProvider.");
    }
    if (typeof model !== "string" || !SAFE_MODEL_REGEX.test(model)) {
      throw new ProviderError(
        `Invalid model identifier "${sanitizeTerminalText(String(model))}".`,
        "INVALID_MODEL"
      );
    }

    this.apiKey = apiKey.trim();
    this.model = model;
    this.baseURL = getGeminiBaseUrl();
    this.client =
      httpClient ||
      defaultHttpClientOverride ||
      axios.create({
        baseURL: this.baseURL,
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_CONTENT_LENGTH,
        maxBodyLength: MAX_REQUEST_BYTES,
      });
  }

  /**
   * Translates raw HTTP/axios errors into sanitized, stable ProviderErrors.
   * Strips out any credential material or raw payload text.
   */
  classifyError(err) {
    if (err instanceof ProviderError) return err;

    if (err.response) {
      const status = err.response.status;
      const rawApiMessage = err.response.data?.error?.message || "";
      const apiMessage = redactSecretText(rawApiMessage, [this.apiKey]);

      if (
        status === 400 &&
        (apiMessage.includes("API_KEY_INVALID") || apiMessage.includes("API key not valid"))
      ) {
        return new ProviderError(
          "Your Gemini API key is invalid. Run `git pilot setup` to configure a valid key.",
          "INVALID_KEY",
          status
        );
      }

      if (status === 401 || status === 403) {
        return new ProviderError(
          "Access denied by Gemini API (401/403). Check that your API key is valid and has permissions.",
          "PERMISSION_DENIED",
          status
        );
      }

      if (status === 429 || apiMessage.includes("RESOURCE_EXHAUSTED")) {
        return new ProviderError(
          "Gemini API rate limit or quota exceeded. Please check your account quota and billing status.",
          "QUOTA_EXCEEDED",
          status
        );
      }

      if (status === 404 || apiMessage.includes("models/")) {
        return new ProviderError(
          `Configured Gemini model "${this.model}" is unavailable to this API key or Google project. ` +
            `Check model access, or change the "model" value in your Git Pilot config and rerun ` +
            "`git pilot setup`.",
          "MODEL_NOT_FOUND",
          status
        );
      }

      return new ProviderError(
        `Gemini API request failed (${status}): ${sanitizeTerminalText(apiMessage || "Unknown error")}`,
        "PROVIDER_ERROR",
        status
      );
    }

    const cleanMsg = redactSecretText(err.message || "Unknown", [this.apiKey]);

    if (err.code === "ECONNABORTED" || cleanMsg.includes("timeout")) {
      return new ProviderError(
        "Request to Gemini API timed out. Please check your network connection.",
        "TIMEOUT"
      );
    }

    if (
      err.code === "ENOTFOUND" ||
      err.code === "ECONNREFUSED" ||
      cleanMsg.includes("Network Error")
    ) {
      return new ProviderError(
        "Could not connect to Gemini API. Check your internet connection.",
        "NETWORK_ERROR"
      );
    }

    return new ProviderError(`Unexpected error: ${sanitizeTerminalText(cleanMsg)}`, "UNKNOWN");
  }

  /**
   * Validates the provided API key with a minimal request without repository data.
   */
  async validateKey() {
    try {
      const endpoint = `/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
      const body = {
        contents: [
          {
            parts: [{ text: "ping" }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1,
        },
      };

      await this.client.post(endpoint, body, {
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
      });

      return { valid: true };
    } catch (err) {
      throw this.classifyError(err);
    }
  }

  /**
   * Sends prompt directly to Gemini and returns response text.
   * Enforces serialized UTF-8 byte limit before sending and retries once on transient errors (429/503).
   */
  async generate(prompt) {
    const endpoint = `/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const body = buildGeminiRequestBody(prompt);
    const serialized = JSON.stringify(body);
    const byteLength = Buffer.byteLength(serialized, "utf8");

    if (byteLength > MAX_REQUEST_BYTES) {
      throw new ProviderError(
        `Request payload (${byteLength} bytes) exceeds maximum allowed size (${MAX_REQUEST_BYTES} bytes).`,
        "PAYLOAD_TOO_LARGE",
        413
      );
    }

    let attempts = 0;
    const maxRetries = 1;

    while (attempts <= maxRetries) {
      attempts++;
      try {
        const response = await this.client.post(endpoint, body, {
          headers: {
            "x-goog-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
        });

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== "string") {
          throw new ProviderError(
            "Gemini response did not contain expected content.",
            "EMPTY_RESPONSE"
          );
        }

        return sanitizeTerminalText(text);
      } catch (err) {
        const classified = this.classifyError(err);
        const isTransient = classified.status === 429 || classified.status === 503;

        if (isTransient && attempts <= maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempts));
          continue;
        }

        throw classified;
      }
    }
  }
}
