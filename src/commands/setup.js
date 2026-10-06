import chalk from "chalk";
import {
  loadConfig,
  hasAcceptedCurrentNotice,
  recordNoticeAcceptance,
  CURRENT_NOTICE_VERSION,
} from "../lib/config.js";
import {
  getApiKey,
  getEnvApiKey,
  getStoredApiKey,
  setApiKey,
  maskApiKey,
} from "../lib/credentials.js";
import { GeminiProvider, OFFICIAL_GEMINI_HOSTNAME } from "../lib/provider.js";
import {
  spin,
  confirm,
  promptMaskedPassword,
  success,
  warn,
  aborted,
  handleError,
} from "../lib/ui.js";

export function printPrivacyNotice({
  dataDescription = "staged diff and optional intent",
  model = loadConfig().model,
} = {}) {
  console.error(
    chalk.bold.cyan(`\n✈  Git Pilot Data-Sharing & Privacy Notice (v${CURRENT_NOTICE_VERSION})`)
  );
  console.error(
    chalk.dim("────────────────────────────────────────────────────────────────────────")
  );
  console.error(chalk.yellow(" • Provider: ") + `Google Gemini (${OFFICIAL_GEMINI_HOSTNAME})`);
  console.error(chalk.yellow(" • Model:    ") + model);
  console.error(chalk.yellow(" • Sent:     ") + dataDescription);
  console.error(chalk.dim("              Unstaged and untracked files are not sent."));
  console.error(
    chalk.yellow(" • API key:  ") + "Stored in your OS credential manager; sent directly to Google."
  );
  console.error(
    chalk.yellow(" • Screening:") +
      " Common secrets are checked locally, but this check is not exhaustive."
  );
  console.error(
    chalk.dim("────────────────────────────────────────────────────────────────────────\n")
  );
}

export async function runGuidedSetup({ isFirstRun = false } = {}) {
  let spinner;
  try {
    const config = loadConfig();
    printPrivacyNotice({ model: config.model });

    const envKey = getEnvApiKey("gemini");
    const storedKey = await getStoredApiKey("gemini");

    if (envKey) {
      warn(
        `${envKey.envVarName} is currently set in your environment (${maskApiKey(envKey.key)}). ` +
          `Setup will save your key to the OS credential manager, but ${envKey.envVarName} will continue to shadow the stored key until you unset it in your shell.`
      );
    }

    if (storedKey && !isFirstRun) {
      warn(
        `An API key is already stored in the OS credential manager (${maskApiKey(storedKey.key)}).`
      );
      const proceed = await confirm("Do you want to replace the stored key?", false);
      if (!proceed) {
        console.log("Setup cancelled.");
        return;
      }
    }

    const agree = await confirm("Do you acknowledge this data flow and wish to proceed?", false);
    if (!agree) {
      console.log("Setup aborted. No changes were made.");
      return;
    }

    console.error(chalk.dim("\nGet a Gemini API key at: https://aistudio.google.com/app/apikey\n"));

    const key = await promptMaskedPassword("Enter your Gemini API key:");
    if (!key) {
      warn("Setup aborted: API key cannot be empty.");
      return;
    }

    spinner = spin("Validating API key with Google Gemini...");
    const provider = new GeminiProvider({ apiKey: key, model: config.model });
    await provider.validateKey();
    spinner.succeed("API key successfully validated!");

    await setApiKey("gemini", key);
    recordNoticeAcceptance();

    console.log();
    success(`Setup complete! Stored in OS credential manager as ${maskApiKey(key)}.`);
    if (envKey) {
      warn(
        `Reminder: ${envKey.envVarName} is still set in your environment and will take precedence until unset.`
      );
    }
    console.log(
      chalk.cyan(
        "\nTry it out: stage changes with `git add` and run " +
          chalk.bold("`git pilot`") +
          " to generate a commit message.\n"
      )
    );
  } catch (err) {
    const reportedError =
      err?.code === "MODEL_NOT_FOUND"
        ? new Error(
            `${err.message}\nSetup did not save the entered key. Any previously stored key is unchanged.`,
            { cause: err }
          )
        : err;
    handleError(reportedError, spinner);
  }
}

/**
 * Ensures both a valid API key and a versioned data-sharing notice acknowledgement
 * are present before any provider request is made—including when GEMINI_API_KEY is supplied via env.
 * In non-interactive or `--dry-run` mode, never prompts interactively; fails early with setup steps
 * unless explicit automation consent (`--accept-notice` or `GIT_PILOT_ACCEPT_NOTICE=1`) is provided.
 */
export async function ensureProviderReady({
  dataDescription = "staged git diff and commit intent",
  nonInteractive = false,
  acceptNotice = false,
} = {}) {
  const isNonInteractive = Boolean(nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY);
  const hasExplicitConsent = Boolean(
    acceptNotice ||
    process.env.GIT_PILOT_ACCEPT_NOTICE === "1" ||
    process.env.GIT_PILOT_ACCEPT_NOTICE === "true"
  );

  let config = loadConfig();
  let keyInfo = await getApiKey(config.provider);

  if (!keyInfo) {
    if (isNonInteractive) {
      console.error(
        chalk.red(
          "Error: No Gemini API key configured for non-interactive execution.\n" +
            "To configure Git Pilot:\n" +
            "  1. Run `git pilot setup` in an interactive terminal, OR\n" +
            "  2. Set `GEMINI_API_KEY` in your environment and pass `--accept-notice` (or set `GIT_PILOT_ACCEPT_NOTICE=1`)."
        )
      );
      process.exit(1);
    }

    console.error(chalk.yellow("\nNo API key found. Starting one-time guided setup...\n"));
    await runGuidedSetup({ isFirstRun: true });
    config = loadConfig();
    keyInfo = await getApiKey(config.provider);
    if (!keyInfo) {
      console.error(chalk.red("Setup was not completed. Aborting."));
      return null;
    }
  }

  if (!hasAcceptedCurrentNotice(config)) {
    if (hasExplicitConsent) {
      config = recordNoticeAcceptance();
      return { config, keyInfo };
    }

    if (isNonInteractive) {
      printPrivacyNotice({ dataDescription, model: config.model });
      console.error(
        chalk.red(
          "Error: Data-sharing notice has not been acknowledged yet (fresh configuration).\n" +
            "To proceed in non-interactive or `--dry-run` mode:\n" +
            "  1. Run `git pilot setup` once in an interactive terminal to review and accept the notice, OR\n" +
            "  2. Pass `--accept-notice` (or set `GIT_PILOT_ACCEPT_NOTICE=1`) to explicitly acknowledge sending " +
            `${dataDescription} to Google Gemini (${OFFICIAL_GEMINI_HOSTNAME}).`
        )
      );
      process.exit(1);
    }

    printPrivacyNotice({ dataDescription, model: config.model });
    const agreed = await confirm(
      `Acknowledge sending ${dataDescription} to Google Gemini (${OFFICIAL_GEMINI_HOSTNAME})?`,
      false
    );
    if (!agreed) {
      aborted("Data-sharing notice was not accepted. No request was sent.");
      return null;
    }
    config = recordNoticeAcceptance();
  }

  return { config, keyInfo };
}

export async function setupCommand() {
  await runGuidedSetup({ isFirstRun: false });
}
