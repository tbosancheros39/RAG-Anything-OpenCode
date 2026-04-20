/**
 * Quick Setup Wizard
 *
 * Zero-config setup with smart defaults.
 * Reduces setup time from 15 minutes to 30 seconds.
 */

import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  detectEnvironment,
  generateSmartDefaults,
  printEnvironmentSummary,
  getSetupRecommendation,
} from "./smart-defaults.js";
import { getRuntimePaths } from "../runtime/paths.js";

interface WizardConfig {
  botToken: string;
  allowedUserIds: string;
  modelProvider: string;
  modelId: string;
}

/**
 * Run the quick setup wizard
 */
export async function runQuickSetup(): Promise<void> {
  console.log("\n🚀 OpenCode Telegram Bot - Quick Setup\n");
  console.log("=".repeat(50));

  // 1. Detect environment
  const env = detectEnvironment();
  printEnvironmentSummary(env);

  // 2. Check prerequisites
  if (!env.opencodePath) {
    console.error("\n❌ OpenCode CLI not found!");
    console.log("\nInstall it first:");
    console.log("  npm install -g @opencode-ai/cli");
    process.exit(1);
  }

  // 3. Show recommendations
  const recommendation = getSetupRecommendation(env);
  if (recommendation) {
    console.log(recommendation);
  }

  // 4. Run interactive wizard (minimal prompts)
  const config = await runInteractiveWizard(env);

  // 5. Generate config files
  await generateConfigFiles(config, env);

  // 6. Success message
  console.log("\n" + "=".repeat(50));
  console.log("\n✅ Setup complete!\n");
  console.log("Start the bot:");
  console.log("  opencode-telegram start\n");
  console.log("Or run diagnostics:");
  console.log("  opencode-telegram doctor\n");
}

/**
 * Run minimal interactive wizard
 */
async function runInteractiveWizard(
  env: ReturnType<typeof detectEnvironment>,
): Promise<WizardConfig> {
  const rl = createInterface({ input, output });

  try {
    console.log("\n📝 Configuration (3 questions):\n");

    // Question 1: Bot Token
    let botToken = "";
    while (!botToken) {
      console.log("1. Telegram Bot Token");
      console.log("   Get it from @BotFather: https://t.me/BotFather");
      const token = await rl.question("   Token: ");

      if (isValidBotToken(token)) {
        botToken = token.trim();
        console.log("   ✅ Token looks valid\n");
      } else {
        console.log("   ❌ Invalid format. Expected: 123456:ABC-DEF...\n");
      }
    }

    // Question 2: User ID
    let allowedUserIds = "";
    while (!allowedUserIds) {
      console.log("2. Your Telegram User ID");
      console.log("   Get it from @userinfobot: https://t.me/userinfobot");
      const userId = await rl.question("   User ID: ");

      if (isValidUserId(userId)) {
        allowedUserIds = userId.trim();
        console.log("   ✅ User ID saved\n");
      } else {
        console.log("   ❌ Invalid. Expected: numeric ID (e.g., 123456789)\n");
      }
    }

    // Question 3: Model (with default)
    const defaults = generateSmartDefaults(env);
    console.log("3. Default Model (optional)");
    console.log(
      `   Press Enter for default: ${defaults.redis.enabled ? "big-pickle" : "claude-3.5-sonnet"}`,
    );
    const modelInput = await rl.question("   Model [opencode/big-pickle]: ");

    const [provider, modelId] = modelInput.includes("/")
      ? modelInput.split("/")
      : ["opencode", modelInput || "big-pickle"];

    console.log(`   ✅ Using: ${provider}/${modelId}\n`);

    return {
      botToken,
      allowedUserIds,
      modelProvider: provider,
      modelId: modelId,
    };
  } finally {
    rl.close();
  }
}

/**
 * Generate configuration files
 */
async function generateConfigFiles(
  config: WizardConfig,
  env: ReturnType<typeof detectEnvironment>,
): Promise<void> {
  const paths = getRuntimePaths();
  const defaults = generateSmartDefaults(env);

  // Ensure config directory exists
  await mkdir(path.dirname(paths.envFilePath), { recursive: true });

  // Generate .env file
  const envContent = generateEnvFile(config, defaults);
  await writeFile(paths.envFilePath, envContent);

  console.log(`💾 Configuration saved to: ${paths.envFilePath}`);
}

/**
 * Generate .env file content
 */
function generateEnvFile(
  config: WizardConfig,
  defaults: ReturnType<typeof generateSmartDefaults>,
): string {
  return `# OpenCode Telegram Bot Configuration
# Generated on: ${new Date().toISOString()}

# === REQUIRED ===
TELEGRAM_BOT_TOKEN=${config.botToken}
TELEGRAM_ALLOWED_USER_IDS=${config.allowedUserIds}

# === MODEL ===
OPENCODE_MODEL_PROVIDER=${config.modelProvider}
OPENCODE_MODEL_ID=${config.modelId}

# === OPTIONAL (sensible defaults applied) ===
# Redis configuration
REDIS_URL=${defaults.redis.url}
# REDIS_ENABLED=${defaults.redis.enabled}

# Bot settings
BOT_LOCALE=${defaults.bot.locale}
SESSIONS_LIST_LIMIT=10
PROJECTS_LIST_LIMIT=10
TASK_LIMIT=${defaults.bot.taskLimit}

# Feature flags
# Scheduled tasks, TTS, and voice require additional configuration
# See documentation for setup: https://docs.opencode-bot.dev

# === ADVANCED ===
# OPENCODE_API_URL=http://localhost:4097
# OPENCODE_SERVER_USERNAME=opencode
# OPENCODE_SERVER_PASSWORD=
# LOG_LEVEL=info
`;
}

/**
 * Validate bot token format
 */
function isValidBotToken(token: string): boolean {
  const trimmed = token.trim();
  // Format: 123456:ABC-DEF1234...
  return /^\d+:[A-Za-z0-9_-]+$/.test(trimmed);
}

/**
 * Validate user ID format
 */
function isValidUserId(userId: string): boolean {
  const trimmed = userId.trim();
  const num = parseInt(trimmed, 10);
  return !isNaN(num) && num > 0 && trimmed === num.toString();
}
