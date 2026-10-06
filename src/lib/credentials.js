import { execa } from "execa";
import process from "node:process";

export const SERVICE_NAME = "git-pilot";
const SAFE_IDENTIFIER = /^[a-zA-Z0-9._-]+$/;

const WINDOWS_CREDENTIAL_MANAGER_SOURCE = `
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class GitPilotCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct NativeCredential {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref NativeCredential credential, UInt32 flags);
  [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("Advapi32.dll", SetLastError = false)]
  private static extern void CredFree(IntPtr credential);

  public static bool Probe() { return true; }

  public static void Write(string target, string username, byte[] secret) {
    IntPtr blob = Marshal.AllocHGlobal(secret.Length);
    try {
      Marshal.Copy(secret, 0, blob, secret.Length);
      var credential = new NativeCredential {
        Type = 1, TargetName = target, CredentialBlobSize = (UInt32)secret.Length,
        CredentialBlob = blob, Persist = 2, UserName = username
      };
      if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(blob); }
  }

  public static byte[] Read(string target, out int error) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) { error = Marshal.GetLastWin32Error(); return null; }
    try {
      var credential = (NativeCredential)Marshal.PtrToStructure(pointer, typeof(NativeCredential));
      var secret = new byte[credential.CredentialBlobSize];
      if (secret.Length > 0) Marshal.Copy(credential.CredentialBlob, secret, 0, secret.Length);
      error = 0;
      return secret;
    } finally { CredFree(pointer); }
  }

  public static bool Delete(string target, out int error) {
    if (CredDelete(target, 1, 0)) { error = 0; return true; }
    error = Marshal.GetLastWin32Error();
    return false;
  }
}
`;

function windowsCredentialScript(action, service, account) {
  const target = `${service}/${account}`;
  const prelude = `$ErrorActionPreference = 'Stop';\nAdd-Type -TypeDefinition @'\n${WINDOWS_CREDENTIAL_MANAGER_SOURCE}\n'@;\n`;

  if (action === "probe") {
    return `${prelude}[GitPilotCredentialManager]::Probe() | Out-Null; 'OK'`;
  }
  if (action === "get") {
    return `${prelude}$errorCode = 0; $secret = [GitPilotCredentialManager]::Read('${target}', [ref]$errorCode); if ($null -eq $secret) { if ($errorCode -eq 1168) { exit 44 }; throw [ComponentModel.Win32Exception]::new($errorCode) }; [Console]::Out.Write([Convert]::ToBase64String($secret))`;
  }
  if (action === "set") {
    return `${prelude}$encoded = [Console]::In.ReadToEnd().Trim(); $secret = [Convert]::FromBase64String($encoded); [GitPilotCredentialManager]::Write('${target}', '${account}', $secret)`;
  }
  return `${prelude}$errorCode = 0; if ([GitPilotCredentialManager]::Delete('${target}', [ref]$errorCode)) { exit 0 }; if ($errorCode -eq 1168) { exit 44 }; throw [ComponentModel.Win32Exception]::new($errorCode)`;
}

export class CredentialStoreUnavailableError extends Error {
  constructor(message, platform) {
    super(message);
    this.name = "CredentialStoreUnavailableError";
    this.platform = platform;
  }
}

/**
 * Redacts any occurrence of a secret (and its hex representation) or key-shaped token from text.
 */
export function redactSecretText(text, secrets = []) {
  if (typeof text !== "string" || !text) return "";
  let out = text;
  const envKey = process.env.GEMINI_API_KEY?.trim();
  const allSecrets = [...secrets, envKey].filter((s) => typeof s === "string" && s.length > 0);

  for (const s of allSecrets) {
    out = out.replaceAll(s, "[REDACTED]");
    const hex = Buffer.from(s, "utf8").toString("hex");
    if (hex.length >= 8) {
      out = out.replaceAll(hex, "[REDACTED]");
    }
  }

  // Also redact Google API key patterns
  out = out.replace(/\bAIza[0-9A-Za-z-_]{20,}\b/g, "[REDACTED]");
  return out;
}

function assertSafeIdentifier(value, label) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `Invalid ${label}: must contain only alphanumeric, '.', '_', or '-' characters.`
    );
  }
}

/**
 * MemoryCredentialStore provides an in-memory implementation for testing.
 */
export class MemoryCredentialStore {
  constructor() {
    this.store = new Map();
    this.platform = "memory";
  }

  async isAvailable() {
    return { available: true };
  }

  async getPassword(service, account) {
    return this.store.get(`${service}:${account}`) ?? null;
  }

  async setPassword(service, account, password) {
    this.store.set(`${service}:${account}`, password);
  }

  async deletePassword(service, account) {
    return this.store.delete(`${service}:${account}`);
  }
}

/**
 * OsCredentialStore delegates to native OS credential tools without a shell.
 * Secrets are passed exclusively via stdin, never in process argv.
 */
export class OsCredentialStore {
  constructor(optionsOrPlatform = process.platform) {
    if (typeof optionsOrPlatform === "string") {
      this.platform = optionsOrPlatform;
      this.execFn = execa;
      this.keychainPath = null;
    } else {
      this.platform = optionsOrPlatform?.platform || process.platform;
      this.execFn = optionsOrPlatform?.execFn || execa;
      this.keychainPath = optionsOrPlatform?.keychainPath || null;
    }
  }

  async isAvailable() {
    if (this.platform === "darwin") {
      try {
        await this.execFn("/usr/bin/security", ["default-keychain"]);
        return { available: true };
      } catch (err) {
        return {
          available: false,
          reason: `macOS Keychain is inaccessible: ${redactSecretText(err.stderr || err.message)}`,
        };
      }
    }

    if (this.platform === "linux") {
      try {
        await this.execFn("which", ["secret-tool"]);
        return { available: true };
      } catch {
        return {
          available: false,
          reason:
            "Linux Secret Service utility 'secret-tool' was not found. " +
            "Please install libsecret-tools (e.g. `sudo apt install libsecret-tools` or `pacman -S libsecret`) " +
            "and ensure a Secret Service daemon (such as GNOME Keyring or KeePassXC) is running.",
        };
      }
    }

    if (this.platform === "win32") {
      try {
        await this.execFn("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          windowsCredentialScript("probe", "git-pilot", "availability"),
        ]);
        return { available: true };
      } catch {
        return {
          available: false,
          reason: "Windows Credential Manager is unavailable.",
        };
      }
    }

    return {
      available: false,
      reason: `Unsupported platform for OS credential storage: ${this.platform}`,
    };
  }

  async getPassword(service, account) {
    assertSafeIdentifier(service, "service");
    assertSafeIdentifier(account, "account");

    const status = await this.isAvailable();
    if (!status.available) {
      throw new CredentialStoreUnavailableError(status.reason, this.platform);
    }

    if (this.platform === "darwin") {
      try {
        const args = ["find-generic-password", "-s", service, "-a", account, "-w"];
        if (this.keychainPath) args.push(this.keychainPath);
        const { stdout } = await this.execFn("/usr/bin/security", args);
        return stdout.trim();
      } catch (err) {
        const msg = err.stderr || err.message || "";
        // Exit code 44 on macOS security means item not found
        if (err.exitCode === 44 || msg.includes("could not be found")) {
          return null;
        }
        throw new CredentialStoreUnavailableError(
          `macOS Keychain lookup failed: ${redactSecretText(msg)}`,
          this.platform
        );
      }
    }

    if (this.platform === "linux") {
      try {
        const { stdout } = await this.execFn("secret-tool", [
          "lookup",
          "service",
          service,
          "account",
          account,
        ]);
        return stdout.trim() || null;
      } catch (err) {
        const msg = err.stderr || err.message || "";
        if (
          err.exitCode === 1 &&
          !msg.toLowerCase().includes("dbus") &&
          !msg.toLowerCase().includes("secret service") &&
          !msg.toLowerCase().includes("cannot autolaunch")
        ) {
          return null;
        }
        throw new CredentialStoreUnavailableError(
          `Linux Secret Service lookup failed: ${redactSecretText(msg || "Secret Service daemon unavailable")}`,
          this.platform
        );
      }
    }

    if (this.platform === "win32") {
      try {
        const { stdout } = await this.execFn("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          windowsCredentialScript("get", service, account),
        ]);
        const encoded = stdout.trim();
        return encoded ? Buffer.from(encoded, "base64").toString("utf8") : null;
      } catch (err) {
        if (err.exitCode === 44) return null;
        throw new CredentialStoreUnavailableError(
          `Windows Credential Manager lookup failed: ${redactSecretText(err.stderr || err.message)}`,
          this.platform
        );
      }
    }

    return null;
  }

  async setPassword(service, account, password) {
    assertSafeIdentifier(service, "service");
    assertSafeIdentifier(account, "account");

    const status = await this.isAvailable();
    if (!status.available) {
      throw new CredentialStoreUnavailableError(status.reason, this.platform);
    }

    try {
      if (this.platform === "darwin") {
        // Use `security -i` (interactive stdin mode) with `-X <hex>` so the secret
        // never appears in process argv (`ps`) and avoids shell/quote parsing issues.
        const hexPassword = Buffer.from(password, "utf8").toString("hex");
        const keychainArg = this.keychainPath
          ? ` "${this.keychainPath.replace(/(["\\])/g, "\\$1")}"`
          : "";
        const commandLine = `add-generic-password -U -s ${service} -a ${account} -X ${hexPassword}${keychainArg}\n`;
        await this.execFn("/usr/bin/security", ["-i"], {
          input: commandLine,
        });
        return;
      }

      if (this.platform === "linux") {
        // Pass password over stdin to avoid revealing in process arguments
        await this.execFn(
          "secret-tool",
          ["store", `--label=Git Pilot (${account})`, "service", service, "account", account],
          { input: password }
        );
        return;
      }

      if (this.platform === "win32") {
        await this.execFn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            windowsCredentialScript("set", service, account),
          ],
          { input: Buffer.from(password, "utf8").toString("base64") }
        );
      }
    } catch (err) {
      const sanitized = redactSecretText(
        err.stderr || err.shortMessage || err.message || "Failed to write to OS credential store.",
        [password]
      );
      throw new CredentialStoreUnavailableError(
        `Could not store credential in OS credential store: ${sanitized}`,
        this.platform
      );
    }
  }

  async deletePassword(service, account) {
    assertSafeIdentifier(service, "service");
    assertSafeIdentifier(account, "account");

    const status = await this.isAvailable();
    if (!status.available) {
      throw new CredentialStoreUnavailableError(status.reason, this.platform);
    }

    if (this.platform === "darwin") {
      try {
        const args = ["delete-generic-password", "-s", service, "-a", account];
        if (this.keychainPath) args.push(this.keychainPath);
        await this.execFn("/usr/bin/security", args);
        return true;
      } catch (err) {
        const msg = err.stderr || err.message || "";
        if (err.exitCode === 44 || msg.includes("could not be found")) {
          return false;
        }
        throw new CredentialStoreUnavailableError(
          `macOS Keychain delete failed: ${redactSecretText(msg)}`,
          this.platform
        );
      }
    }

    if (this.platform === "linux") {
      try {
        await this.execFn("secret-tool", ["clear", "service", service, "account", account]);
        return true;
      } catch (err) {
        if (err.exitCode === 1) return false;
        throw new CredentialStoreUnavailableError(
          `Linux Secret Service delete failed: ${redactSecretText(err.stderr || err.message)}`,
          this.platform
        );
      }
    }

    if (this.platform === "win32") {
      try {
        await this.execFn("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          windowsCredentialScript("delete", service, account),
        ]);
        return true;
      } catch (err) {
        if (err.exitCode === 44) return false;
        throw new CredentialStoreUnavailableError(
          `Windows Credential Manager delete failed: ${redactSecretText(err.stderr || err.message)}`,
          this.platform
        );
      }
    }

    return false;
  }
}

let activeBackend = new OsCredentialStore();

/** Override active backend (useful for testing) */
export function setCredentialBackend(backend) {
  activeBackend = backend;
}

export function getCredentialBackend() {
  return activeBackend;
}

export function getEnvVarName(provider = "gemini") {
  return provider === "gemini" ? "GEMINI_API_KEY" : `${provider.toUpperCase()}_API_KEY`;
}

/**
 * Returns the environment-provided API key if set, without touching the OS credential store.
 */
export function getEnvApiKey(provider = "gemini") {
  const envVarName = getEnvVarName(provider);
  const envVal = process.env[envVarName]?.trim();
  if (envVal) {
    return { key: envVal, source: "env", envVarName };
  }
  return null;
}

/**
 * Returns the API key stored in the OS credential store, ignoring environment variables.
 */
export async function getStoredApiKey(provider = "gemini") {
  const stored = await activeBackend.getPassword(SERVICE_NAME, provider);
  if (stored) {
    return { key: stored, source: "keychain" };
  }
  return null;
}

/**
 * Returns the effective API key for `provider`.
 * Checks GEMINI_API_KEY env var first for CI/ephemeral use,
 * then checks OS credential store.
 * Returns: { key: string, source: "env" | "keychain" } or null if not set.
 */
export async function getApiKey(provider = "gemini") {
  const envKey = getEnvApiKey(provider);
  if (envKey) {
    return { key: envKey.key, source: "env" };
  }
  return getStoredApiKey(provider);
}

/**
 * Stores the API key in the OS credential store.
 * Does NOT persist environment variables.
 */
export async function setApiKey(provider = "gemini", apiKey) {
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error("API key must be a non-empty string.");
  }
  await activeBackend.setPassword(SERVICE_NAME, provider, apiKey.trim());
}

/**
 * Deletes the stored API key from the OS credential store.
 */
export async function deleteApiKey(provider = "gemini") {
  return activeBackend.deletePassword(SERVICE_NAME, provider);
}

/**
 * Masks an API key for safe display in logs and status commands.
 * Examples: AIzaSy...1234 -> AIza...1234
 */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return "****";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "****";
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}
