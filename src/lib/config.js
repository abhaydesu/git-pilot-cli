import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

export const CURRENT_CONFIG_VERSION = 2;
export const CURRENT_NOTICE_VERSION = 1;
export const DEFAULT_PROVIDER = "gemini";
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const LEGACY_DEFAULT_MODEL = "gemini-2.5-flash";

const SAFE_MODEL_REGEX = /^[a-zA-Z0-9._-]+$/;

let customConfigDir = null;

export function setConfigDir(dir) {
  customConfigDir = dir;
}

export function getConfigDir() {
  if (customConfigDir) return customConfigDir;
  if (process.env.GIT_PILOT_CONFIG_DIR) return process.env.GIT_PILOT_CONFIG_DIR;

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "git-pilot");
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "git-pilot");
}

export function getConfigPath() {
  return path.join(getConfigDir(), "config.json");
}

export function getDefaultConfig() {
  return {
    version: CURRENT_CONFIG_VERSION,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    dataSharingNoticeAccepted: false,
    dataSharingNoticeVersion: 0,
    noticeAcceptedAt: null,
  };
}

export function hasAcceptedCurrentNotice(cfg) {
  const effective = cfg || loadConfig();
  return (
    effective?.dataSharingNoticeAccepted === true &&
    effective?.dataSharingNoticeVersion === CURRENT_NOTICE_VERSION
  );
}

export function recordNoticeAcceptance() {
  return saveConfig({
    dataSharingNoticeAccepted: true,
    dataSharingNoticeVersion: CURRENT_NOTICE_VERSION,
    noticeAcceptedAt: new Date().toISOString(),
  });
}

export function validateConfig(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid configuration: root must be an object.");
  }

  if (typeof data.version !== "number") {
    throw new Error("Invalid configuration: missing or invalid 'version'.");
  }

  if (data.provider !== "gemini") {
    throw new Error(
      `Unsupported provider: "${data.provider}". Only "gemini" is supported in this release.`
    );
  }

  if (typeof data.model !== "string" || !SAFE_MODEL_REGEX.test(data.model)) {
    throw new Error(
      `Invalid model name "${data.model}". Model names can only contain alphanumeric characters, dots, underscores, and hyphens.`
    );
  }

  return true;
}

export function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);

    const migrated = { ...getDefaultConfig(), ...parsed };
    if (migrated.version < CURRENT_CONFIG_VERSION) {
      // The old built-in model is restricted for many new API projects. Migrate
      // only the previous default; preserve any user-selected model identifier.
      if (migrated.model === LEGACY_DEFAULT_MODEL) {
        migrated.model = DEFAULT_MODEL;
      }
      migrated.version = CURRENT_CONFIG_VERSION;
    }

    validateConfig(migrated);
    return migrated;
  } catch (err) {
    if (err.name === "SyntaxError") {
      throw new Error(`Corrupted config file at ${configPath}: ${err.message}`, {
        cause: err,
      });
    }
    throw err;
  }
}

export function saveConfig(patch = {}) {
  const dir = getConfigDir();
  const configPath = getConfigPath();

  // Create directory with 0700 permissions on POSIX
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Ignored on filesystems that do not support POSIX chmod
    }
  }

  let current = {};
  if (fs.existsSync(configPath)) {
    try {
      current = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (current.version < CURRENT_CONFIG_VERSION) {
        if (current.model === LEGACY_DEFAULT_MODEL) current.model = DEFAULT_MODEL;
        current.version = CURRENT_CONFIG_VERSION;
      }
    } catch {
      // Fall back to default config if file is unreadable/corrupted
    }
  }

  const updated = {
    ...getDefaultConfig(),
    ...current,
    ...patch,
    version: CURRENT_CONFIG_VERSION,
  };

  validateConfig(updated);

  // Safe atomic write with 0600 permissions
  const tempPath = path.join(dir, `.config.json.tmp.${process.pid}.${Date.now()}`);
  const content = JSON.stringify(updated, null, 2) + "\n";

  fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {
      // Ignored on filesystems that do not support POSIX chmod
    }
  }

  fs.renameSync(tempPath, configPath);
  return updated;
}

export function resetConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/** Redacts any key-like fields for printing or diagnostics */
export function redactConfig(cfg) {
  const copy = { ...cfg };
  for (const k of Object.keys(copy)) {
    if (/key|secret|token|password/i.test(k)) {
      copy[k] = "[REDACTED]";
    }
  }
  return copy;
}
