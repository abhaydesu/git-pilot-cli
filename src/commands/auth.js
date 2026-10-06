import chalk from "chalk";
import { loadConfig, hasAcceptedCurrentNotice } from "../lib/config.js";
import {
  getEnvApiKey,
  getStoredApiKey,
  deleteApiKey,
  maskApiKey,
  getCredentialBackend,
} from "../lib/credentials.js";
import { confirm, success, warn, handleError } from "../lib/ui.js";

function getStoreDisplayName(platform) {
  if (platform === "darwin") return "macOS Keychain";
  if (platform === "linux") return "Linux Secret Service";
  if (platform === "win32") return "Windows Credential Manager";
  return "Custom / In-Memory Store";
}

export async function authStatusCommand() {
  try {
    const config = loadConfig();
    const backend = getCredentialBackend();
    const backendStatus = await backend.isAvailable();
    const envKey = getEnvApiKey(config.provider);
    let storedKey = null;
    if (backendStatus.available) {
      storedKey = await getStoredApiKey(config.provider);
    }

    console.log(chalk.bold.cyan("\nGit Pilot Authentication Status"));
    console.log(
      chalk.dim("────────────────────────────────────────────────────────────────────────")
    );

    console.log(`Provider:         ${chalk.green(config.provider)}`);
    console.log(`Model:            ${chalk.green(config.model)}`);

    const storeName = getStoreDisplayName(backend.platform);
    console.log(
      `Credential Store: ${
        backendStatus.available
          ? chalk.green(storeName)
          : chalk.red(`${storeName} (Unavailable: ${backendStatus.reason || "error"})`)
      }`
    );

    if (storedKey) {
      console.log(
        `Stored Key (OS):  ${chalk.cyan(maskApiKey(storedKey.key))} (${chalk.green("present in OS Credential Manager")})`
      );
    } else {
      console.log(`Stored Key (OS):  ${chalk.dim("None")}`);
    }

    if (envKey) {
      const shadowNote = storedKey ? " — active, shadows stored OS credential" : " — active";
      console.log(
        `Env Override:     ${chalk.cyan(maskApiKey(envKey.key))} (${chalk.yellow(`${envKey.envVarName}${shadowNote}`)})`
      );
    } else {
      console.log(`Env Override:     ${chalk.dim("Not set")}`);
    }

    const effectiveKey = envKey || storedKey;
    if (effectiveKey) {
      const activeSource =
        effectiveKey.source === "env"
          ? `Environment (${envKey.envVarName})`
          : "OS Credential Manager";
      console.log(
        `Effective Key:    ${chalk.cyan(maskApiKey(effectiveKey.key))} (${chalk.green(activeSource)})`
      );
    } else {
      console.log(`Effective Key:    ${chalk.red("Not configured")}`);
      console.log(chalk.dim("\nRun `git pilot setup` to configure your API key."));
    }

    console.log(
      `Privacy Notice:   ${
        hasAcceptedCurrentNotice(config)
          ? chalk.green(
              `Accepted v${config.dataSharingNoticeVersion} (${config.noticeAcceptedAt || "yes"})`
            )
          : chalk.yellow("Pending acknowledgement")
      }`
    );
    console.log(
      chalk.dim("────────────────────────────────────────────────────────────────────────\n")
    );
  } catch (err) {
    handleError(err);
  }
}

export async function authRemoveCommand() {
  try {
    const config = loadConfig();
    const envKey = getEnvApiKey(config.provider);
    const storedKey = await getStoredApiKey(config.provider);

    if (!storedKey) {
      if (envKey) {
        warn(
          `No API key is stored in the OS credential manager. The active key is provided via the ${envKey.envVarName} environment variable — unset it in your shell profile to remove it.`
        );
      } else {
        warn("No stored API key was found in the OS credential manager.");
      }
      return;
    }

    const ok = await confirm(
      `Are you sure you want to remove the stored ${config.provider} API key (${maskApiKey(storedKey.key)}) from the OS credential manager?`,
      false
    );
    if (!ok) {
      console.log("Removal cancelled.");
      return;
    }

    await deleteApiKey(config.provider);
    success("API key removed successfully from the OS credential manager.");

    if (envKey) {
      warn(
        `Note: ${envKey.envVarName} is still set in your environment (${maskApiKey(envKey.key)}) and will continue to be used until unset.`
      );
    }
  } catch (err) {
    handleError(err);
  }
}
