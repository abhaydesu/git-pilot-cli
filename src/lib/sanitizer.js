/**
 * Terminal control sequence sanitizer.
 * Strips ANSI escape sequences, OSC strings, and control characters
 * from untrusted AI output before displaying it in the terminal.
 */

// Matches ANSI escape codes, OSC sequences, cursor controls
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|[\u001b\u009b]\].*?(\u0007|\u001b\\)/g;

// Strip other non-printable ASCII control characters except newline and tab
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g;

export const MAX_MESSAGE_CHARS = 5000;
export const MAX_MESSAGE_LINES = 100;

export function sanitizeTerminalText(input) {
  if (typeof input !== "string") return "";
  let clean = input.replace(ANSI_PATTERN, "").replace(CONTROL_CHARS, "");

  // Normalize line endings
  clean = clean.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Enforce length and line count bounds
  if (clean.length > MAX_MESSAGE_CHARS) {
    clean = clean.slice(0, MAX_MESSAGE_CHARS) + "\n...[output truncated for safety]";
  }

  const lines = clean.split("\n");
  if (lines.length > MAX_MESSAGE_LINES) {
    clean = lines.slice(0, MAX_MESSAGE_LINES).join("\n") + "\n...[output truncated for safety]";
  }

  return clean.trim();
}
