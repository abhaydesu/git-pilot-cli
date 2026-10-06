import test from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_NAME,
  MemoryCredentialStore,
  OsCredentialStore,
  setCredentialBackend,
  getApiKey,
  getEnvApiKey,
  getStoredApiKey,
  setApiKey,
  deleteApiKey,
  maskApiKey,
  redactSecretText,
  CredentialStoreUnavailableError,
} from "../src/lib/credentials.js";

test("MemoryCredentialStore sets, gets, and deletes passwords", async () => {
  const store = new MemoryCredentialStore();
  assert.equal(await store.getPassword("service", "account"), null);

  await store.setPassword("service", "account", "secret123");
  assert.equal(await store.getPassword("service", "account"), "secret123");

  const deleted = await store.deletePassword("service", "account");
  assert.equal(deleted, true);
  assert.equal(await store.getPassword("service", "account"), null);

  const deletedAgain = await store.deletePassword("service", "account");
  assert.equal(deletedAgain, false);
});

test("maskApiKey masks keys safely", () => {
  assert.equal(maskApiKey(""), "****");
  assert.equal(maskApiKey("short"), "****");
  assert.equal(maskApiKey("12345678"), "****");
  assert.equal(maskApiKey("123456789"), "1234...6789");
  assert.equal(maskApiKey("AIzaSyB123456789xyz"), "AIza...9xyz");
});

test("macOS OsCredentialStore.setPassword never passes secret in argv and sanitizes failure errors", async () => {
  const secret = "AIzaSySuperSecretMacKey9876543210";
  const hexSecret = Buffer.from(secret, "utf8").toString("hex");
  const calls = [];

  const mockExec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args[0] === "default-keychain") {
      return { stdout: "/Users/test/Library/Keychains/login.keychain-db" };
    }
    return { stdout: "" };
  };

  const darwinStore = new OsCredentialStore({
    platform: "darwin",
    execFn: mockExec,
  });

  await darwinStore.setPassword("git-pilot", "gemini", secret);

  const writeCall = calls.find((c) => c.args.includes("-i"));
  assert.ok(writeCall, "Expected `security -i` call");
  assert.equal(writeCall.cmd, "/usr/bin/security");
  assert.deepEqual(writeCall.args, ["-i"]);
  // Prove secret and hex secret are completely absent from argv
  for (const arg of writeCall.args) {
    assert.equal(arg.includes(secret), false);
    assert.equal(arg.includes(hexSecret), false);
  }
  assert.ok(writeCall.opts.input.includes(`-X ${hexSecret}`));

  // Now simulate a failure that echoes the input command in error message/stderr
  const failingStore = new OsCredentialStore({
    platform: "darwin",
    execFn: async (cmd, args) => {
      if (args[0] === "default-keychain") return { stdout: "ok" };
      const err = new Error(`Command failed: /usr/bin/security -i with ${secret} and ${hexSecret}`);
      err.stderr = `security error: failed on ${secret} (${hexSecret})`;
      throw err;
    },
  });

  await assert.rejects(
    async () => {
      await failingStore.setPassword("git-pilot", "gemini", secret);
    },
    (err) => {
      assert.equal(err instanceof CredentialStoreUnavailableError, true);
      assert.equal(err.message.includes(secret), false);
      assert.equal(err.message.includes(hexSecret), false);
      assert.ok(err.message.includes("[REDACTED]"));
      return true;
    }
  );
});

test("Linux and Windows OsCredentialStore failure modes produce CredentialStoreUnavailableError", async () => {
  // 1. Linux without secret-tool installed
  const linuxMissing = new OsCredentialStore({
    platform: "linux",
    execFn: async () => {
      throw new Error("not found");
    },
  });
  const linuxStatus = await linuxMissing.isAvailable();
  assert.equal(linuxStatus.available, false);
  assert.match(linuxStatus.reason, /libsecret-tools/);
  await assert.rejects(
    () => linuxMissing.getPassword("git-pilot", "gemini"),
    CredentialStoreUnavailableError
  );

  // 2. Linux with secret-tool present but D-Bus / Secret Service locked/unavailable
  const linuxDbusDown = new OsCredentialStore({
    platform: "linux",
    execFn: async (cmd) => {
      if (cmd === "which") return { stdout: "/usr/bin/secret-tool" };
      const err = new Error("Cannot autolaunch D-Bus without X11 $DISPLAY");
      err.exitCode = 1;
      err.stderr = "Cannot autolaunch D-Bus without X11 $DISPLAY";
      throw err;
    },
  });
  await assert.rejects(
    () => linuxDbusDown.getPassword("git-pilot", "gemini"),
    CredentialStoreUnavailableError
  );

  // 3. Windows with unavailable PasswordVault
  const winUnavailable = new OsCredentialStore({
    platform: "win32",
    execFn: async () => {
      throw new Error("PasswordVault failed");
    },
  });
  const winStatus = await winUnavailable.isAvailable();
  assert.equal(winStatus.available, false);
  await assert.rejects(
    () => winUnavailable.setPassword("git-pilot", "gemini", "key"),
    CredentialStoreUnavailableError
  );
});

test("Windows Credential Manager uses native generic credentials and keeps the key out of argv", async () => {
  const secret = "a-private-api-key-not-for-argv";
  const calls = [];
  const winStore = new OsCredentialStore({
    platform: "win32",
    execFn: async (cmd, args, options = {}) => {
      calls.push({ cmd, args, options });
      const script = args.at(-1);
      if (script.includes("::Probe()")) return { stdout: "OK" };
      if (script.includes("::Read(")) {
        return { stdout: Buffer.from(secret, "utf8").toString("base64") };
      }
      return { stdout: "" };
    },
  });

  assert.deepEqual(await winStore.isAvailable(), { available: true });
  await winStore.setPassword("git-pilot", "gemini", secret);
  const setCall = calls.find(({ args }) => args.at(-1).includes("::Write("));
  assert.ok(setCall);
  assert.equal(setCall.options.input, Buffer.from(secret, "utf8").toString("base64"));
  assert.equal(setCall.args.join(" ").includes(secret), false);
  assert.equal(await winStore.getPassword("git-pilot", "gemini"), secret);
  assert.equal(await winStore.deletePassword("git-pilot", "gemini"), true);
});

test("getApiKey, getEnvApiKey, and getStoredApiKey distinguish environment and stored keys", async () => {
  const store = new MemoryCredentialStore();
  await store.setPassword(SERVICE_NAME, "gemini", "stored-key-12345");
  setCredentialBackend(store);

  const oldEnv = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "env-key-99999";

    const effective = await getApiKey("gemini");
    assert.deepEqual(effective, { key: "env-key-99999", source: "env" });

    // Stored key is still independently inspectable and removable even when env var is set
    const stored = await getStoredApiKey("gemini");
    assert.deepEqual(stored, { key: "stored-key-12345", source: "keychain" });

    const envOnly = getEnvApiKey("gemini");
    assert.deepEqual(envOnly, {
      key: "env-key-99999",
      source: "env",
      envVarName: "GEMINI_API_KEY",
    });

    // Deleting removes the stored key from the OS credential store while env var is present
    const removed = await deleteApiKey("gemini");
    assert.equal(removed, true);
    assert.equal(await getStoredApiKey("gemini"), null);

    delete process.env.GEMINI_API_KEY;
    assert.equal(await getApiKey("gemini"), null);
  } finally {
    if (oldEnv) process.env.GEMINI_API_KEY = oldEnv;
    else delete process.env.GEMINI_API_KEY;
  }
});

test("setApiKey validates key and saves to credential store", async () => {
  const store = new MemoryCredentialStore();
  setCredentialBackend(store);

  await assert.rejects(async () => {
    await setApiKey("gemini", "");
  }, /non-empty string/);

  await setApiKey("gemini", "new-gemini-key");
  assert.equal(await store.getPassword(SERVICE_NAME, "gemini"), "new-gemini-key");

  await deleteApiKey("gemini");
  assert.equal(await store.getPassword(SERVICE_NAME, "gemini"), null);
});

test("redactSecretText strips raw secrets, hex secrets, and Google API key patterns", () => {
  const raw = "Error with AIzaSyD-1234567890abcdefghijklmnopqrst and my-custom-secret";
  const cleaned = redactSecretText(raw, ["my-custom-secret"]);
  assert.equal(cleaned.includes("AIzaSyD"), false);
  assert.equal(cleaned.includes("my-custom-secret"), false);
  assert.equal(cleaned, "Error with [REDACTED] and [REDACTED]");
});

test("real native OS credential store smoke test (macOS Keychain / Linux Secret Service / Windows)", async (t) => {
  const { execa } = await import("execa");
  const path = await import("node:path");
  const fs = await import("node:fs");

  const requireNative = process.env.GIT_PILOT_REQUIRE_NATIVE_STORE_TEST === "1";
  const service = `git-pilot-smoke-${process.pid}`;
  const account = "gemini";
  const secret1 = "AIzaSyRealNativeStoreSmokeKey1111111111";
  const secret2 = "AIzaSyRealNativeStoreSmokeKey2222222222";

  if (process.platform === "darwin") {
    // Use `/tmp` directly (rather than `os.tmpdir()` under `/var/folders/...`) and an isolated
    // HOME directory so `/usr/bin/security` never touches the user's login keychain or `~/Library`.
    const baseTmp = fs.existsSync("/tmp") ? "/tmp" : (await import("node:os")).tmpdir();
    const tmpHome = fs.mkdtempSync(path.join(baseTmp, `gp-kc-home-${process.pid}-`));
    const kcDir = path.join(tmpHome, "Library", "Keychains");
    const prefDir = path.join(tmpHome, "Library", "Preferences");
    fs.mkdirSync(kcDir, { recursive: true });
    fs.mkdirSync(prefDir, { recursive: true });

    const kcPath = path.join(kcDir, "smoke.keychain-db");
    const kcEnv = { ...process.env, HOME: tmpHome };
    const runSec = (cmd, args, opts = {}) => execa(cmd, args, { ...opts, env: kcEnv });

    try {
      try {
        await runSec("/usr/bin/security", ["create-keychain", "-p", "smoke-pass", kcPath]);
        await runSec("/usr/bin/security", ["list-keychains", "-d", "user", "-s", kcPath]);
        await runSec("/usr/bin/security", ["default-keychain", "-s", kcPath]);
        await runSec("/usr/bin/security", ["unlock-keychain", "-p", "smoke-pass", kcPath]);
      } catch (setupErr) {
        if (!requireNative) {
          t.skip(
            `Skipping macOS Keychain smoke test: environment does not permit temporary keychain creation (${setupErr.shortMessage || setupErr.message})`
          );
          return;
        }
        throw setupErr;
      }

      const realDarwinStore = new OsCredentialStore({
        platform: "darwin",
        execFn: runSec,
      });

      assert.equal(await realDarwinStore.getPassword(service, account), null);

      await realDarwinStore.setPassword(service, account, secret1);
      assert.equal(await realDarwinStore.getPassword(service, account), secret1);

      // Update (-U) existing entry via `security -i`
      await realDarwinStore.setPassword(service, account, secret2);
      assert.equal(await realDarwinStore.getPassword(service, account), secret2);

      const deleted = await realDarwinStore.deletePassword(service, account);
      assert.equal(deleted, true);
      assert.equal(await realDarwinStore.getPassword(service, account), null);
      assert.equal(await realDarwinStore.deletePassword(service, account), false);
    } finally {
      try {
        await runSec("/usr/bin/security", ["delete-keychain", kcPath]);
      } catch {
        // ignore cleanup error
      }
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
    return;
  }

  if (process.platform === "linux") {
    const realLinuxStore = new OsCredentialStore("linux");
    const status = await realLinuxStore.isAvailable();
    if (!status.available || !process.env.DBUS_SESSION_BUS_ADDRESS) {
      if (requireNative) {
        assert.fail(
          "GIT_PILOT_REQUIRE_NATIVE_STORE_TEST=1 is set, but Linux Secret Service / D-Bus is unavailable."
        );
      }
      // Headless Linux environment without Secret Service: verify fail-closed behavior
      await assert.rejects(
        () => realLinuxStore.getPassword(service, account),
        CredentialStoreUnavailableError
      );
      t.skip(
        "Linux Secret Service daemon not active in this headless environment (verified fail-closed; full store round-trip skipped)"
      );
      return;
    }
    try {
      assert.equal(await realLinuxStore.getPassword(service, account), null);
      await realLinuxStore.setPassword(service, account, secret1);
      assert.equal(await realLinuxStore.getPassword(service, account), secret1);
      await realLinuxStore.setPassword(service, account, secret2);
      assert.equal(await realLinuxStore.getPassword(service, account), secret2);
      assert.equal(await realLinuxStore.deletePassword(service, account), true);
      assert.equal(await realLinuxStore.getPassword(service, account), null);
    } finally {
      await realLinuxStore.deletePassword(service, account).catch(() => {});
    }
    return;
  }

  if (process.platform === "win32") {
    const realWinStore = new OsCredentialStore("win32");
    const status = await realWinStore.isAvailable();
    if (!status.available && !requireNative) {
      t.skip(`Windows Credential Manager unavailable in this environment: ${status.reason}`);
      return;
    }
    try {
      assert.equal(await realWinStore.getPassword(service, account), null);
      await realWinStore.setPassword(service, account, secret1);
      assert.equal(await realWinStore.getPassword(service, account), secret1);
      await realWinStore.setPassword(service, account, secret2);
      assert.equal(await realWinStore.getPassword(service, account), secret2);
      assert.equal(await realWinStore.deletePassword(service, account), true);
      assert.equal(await realWinStore.getPassword(service, account), null);
    } finally {
      await realWinStore.deletePassword(service, account).catch(() => {});
    }
  }
});
