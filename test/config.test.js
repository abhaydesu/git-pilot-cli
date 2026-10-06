import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  setConfigDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  resetConfig,
  validateConfig,
  redactConfig,
  CURRENT_CONFIG_VERSION,
} from "../src/lib/config.js";

test("config manager lifecycle, permissions, and validation", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-pilot-config-test-"));
  setConfigDir(tmpDir);

  try {
    // Default config when no file exists
    const initial = loadConfig();
    assert.equal(initial.version, CURRENT_CONFIG_VERSION);
    assert.equal(initial.provider, "gemini");
    assert.equal(initial.model, "gemini-3.5-flash-lite");
    assert.equal(initial.dataSharingNoticeAccepted, false);

    // Save partial update
    const updated = saveConfig({
      dataSharingNoticeAccepted: true,
      noticeAcceptedAt: "2026-10-06T00:00:00.000Z",
    });
    assert.equal(updated.dataSharingNoticeAccepted, true);
    assert.equal(updated.noticeAcceptedAt, "2026-10-06T00:00:00.000Z");

    // File was written with 0600 permissions on POSIX
    const configPath = getConfigPath();
    assert.equal(fs.existsSync(configPath), true);
    if (process.platform !== "win32") {
      const stat = fs.statSync(configPath);
      // Check owner read/write (0600)
      assert.equal(stat.mode & 0o777, 0o600);
    }

    // Load back
    const reloaded = loadConfig();
    assert.equal(reloaded.dataSharingNoticeAccepted, true);

    // Validation rejects invalid provider or model
    assert.throws(
      () => validateConfig({ version: 1, provider: "unknown", model: "safe" }),
      /Unsupported provider/
    );
    assert.throws(
      () => validateConfig({ version: 1, provider: "gemini", model: "model; rm -rf /" }),
      /Invalid model name/
    );

    // Redaction
    const redacted = redactConfig({ model: "gemini", secretKey: "secret", apiKey: "123" });
    assert.equal(redacted.secretKey, "[REDACTED]");
    assert.equal(redacted.apiKey, "[REDACTED]");
    assert.equal(redacted.model, "gemini");

    // Reset config
    resetConfig();
    assert.equal(fs.existsSync(configPath), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setConfigDir(null);
  }
});

test("migrates the previous built-in Gemini model while preserving custom models", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-pilot-config-migration-"));
  setConfigDir(tmpDir);

  try {
    const configPath = getConfigPath();
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        provider: "gemini",
        model: "gemini-2.5-flash",
        dataSharingNoticeAccepted: true,
        dataSharingNoticeVersion: 1,
      })
    );

    const migrated = loadConfig();
    assert.equal(migrated.version, CURRENT_CONFIG_VERSION);
    assert.equal(migrated.model, "gemini-3.5-flash-lite");
    assert.equal(migrated.dataSharingNoticeAccepted, true);

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        provider: "gemini",
        model: "gemini-custom-model",
      })
    );
    assert.equal(loadConfig().model, "gemini-custom-model");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setConfigDir(null);
  }
});
