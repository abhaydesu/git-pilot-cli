import axios from "axios";

export const DEFAULT_API_URL = "https://git-pilot-api.vercel.app";

// The API rejects request bodies over 1 MB (bytes, after JSON encoding) and diffs over
// 800,000 characters.
export const MAX_DIFF_CHARS = 800_000;
const MAX_BODY_BYTES = 1_000_000;

/** True if `body` (containing `diff`) is small enough for the API to accept. */
export const fitsInRequest = (body, diff) =>
  diff.length <= MAX_DIFF_CHARS && Buffer.byteLength(JSON.stringify(body)) <= MAX_BODY_BYTES;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function apiBaseUrl() {
  const raw = (process.env.GIT_PILOT_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`GIT_PILOT_API_URL is not a valid URL: ${raw}`);
  }
  // Your staged diffs are sent to this server, so never over plain http except locally.
  const plainHttpOk = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !plainHttpOk) {
    throw new Error("GIT_PILOT_API_URL must use https (plain http is only allowed for localhost).");
  }
  return raw;
}

/** POSTs `body` to `/api/<endpoint>` and returns the parsed response data. */
export async function callApi(endpoint, body) {
  const { data } = await axios.post(`${apiBaseUrl()}/api/${endpoint}`, body, {
    timeout: 30_000,
    maxRedirects: 0, // the API never redirects a POST; don't follow one to somewhere else
    maxContentLength: 1_000_000,
  });
  return data;
}

/** Returns `data[field]` if it is a non-empty string; otherwise throws a clear error. */
export function requireString(data, field) {
  const value = data?.[field];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Unexpected response from the API (missing "${field}").`);
  }
  return value;
}

/** Human-readable message for an axios/network/other error. */
export function describeError(error) {
  if (error.response) {
    const detail = error.response.data?.error || "No message";
    return `API Error: ${error.response.status} - ${detail}`;
  }
  return `An unexpected error occurred: ${error.message}`;
}
