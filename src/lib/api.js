import axios from "axios";

export const DEFAULT_API_URL = "https://git-pilot-api.vercel.app";

// The API rejects request bodies over 1 MB; keep the diff safely below that.
export const MAX_DIFF_CHARS = 800_000;

export const apiBaseUrl = () =>
  (process.env.GIT_PILOT_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");

/** POSTs `body` to `/api/<endpoint>` and returns the parsed response data. */
export async function callApi(endpoint, body) {
  const { data } = await axios.post(`${apiBaseUrl()}/api/${endpoint}`, body, {
    timeout: 30_000,
  });
  return data;
}

/** Human-readable message for an axios/network/other error. */
export function describeError(error) {
  if (error.response) {
    const detail = error.response.data?.error || "No message";
    return `API Error: ${error.response.status} - ${detail}`;
  }
  return `An unexpected error occurred: ${error.message}`;
}
