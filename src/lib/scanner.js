/**
 * Best-effort heuristic secret scanner for staged diffs.
 * Blocks transmission of high-confidence credential patterns (private keys,
 * well-known provider tokens, and explicit secret assignments) before network requests.
 *
 * NOTE: Heuristic pattern matching cannot guarantee that a diff is free of all
 * sensitive material (such as custom passphrases or unstructured tokens). Users are
 * informed via the privacy notice that staged diffs are transmitted to Google Gemini.
 */

const RULES = [
  {
    name: "Private Key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    name: "AWS Access Key ID",
    regex: /\b(AKIA[0-9A-Z]{16})\b/,
  },
  {
    name: "GitHub Token",
    regex: /\b((?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{40,})\b/,
  },
  {
    name: "Slack Token",
    regex: /\b(xox[baprs]-[0-9a-zA-Z-]{10,})\b/,
  },
  {
    name: "Google API Key",
    regex: /\b(AIza[0-9A-Za-z-_]{30,40})\b/,
  },
  {
    name: "Generic Secret / Token Assignment",
    regex:
      /(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|bearer[_-]?token)\s*[:=]\s*['"]([a-zA-Z0-9_-]{20,})['"]/i,
  },
];

function maskMatch(str) {
  if (str.length <= 8) return "****";
  return str.slice(0, 4) + "*".repeat(str.length - 8) + str.slice(-4);
}

export function scanDiffForSecrets(diffText) {
  if (!diffText || typeof diffText !== "string") {
    return { clean: true, findings: [] };
  }

  const findings = [];
  const lines = diffText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("---") || line.startsWith("+++")) continue;

    for (const rule of RULES) {
      const match = rule.regex.exec(line);
      if (match) {
        const rawSecret = match[1] || match[0];
        findings.push({
          rule: rule.name,
          line: i + 1,
          preview: maskMatch(rawSecret),
        });
        break;
      }
    }
  }

  return {
    clean: findings.length === 0,
    findings,
  };
}
