import dotenv from "dotenv";
import { getRuntimePaths } from "./runtime/paths.js";
import { normalizeLocale, type Locale } from "./i18n/index.js";

const runtimePaths = getRuntimePaths();
dotenv.config({ path: runtimePaths.envFilePath, quiet: true });

export type MessageFormatMode = "raw" | "markdown";

function getEnvVar(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(
      `Missing required environment variable: ${key} (expected in ${runtimePaths.envFilePath})`,
    );
  }
  return value || "";
}

function getOptionalPositiveIntEnvVar(key: string, defaultValue: number): number {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return defaultValue;
  }

  return parsedValue;
}

function getOptionalNonNegativeIntEnvVarFromKeys(keys: string[], defaultValue: number): number {
  for (const key of keys) {
    const value = getEnvVar(key, false);
    if (!value) {
      continue;
    }

    const parsedValue = Number.parseInt(value, 10);
    if (Number.isNaN(parsedValue) || parsedValue < 0) {
      return defaultValue;
    }

    return parsedValue;
  }

  return defaultValue;
}

function getOptionalLocaleEnvVar(key: string, defaultValue: Locale): Locale {
  const value = getEnvVar(key, false);
  return normalizeLocale(value, defaultValue);
}

function getOptionalBooleanEnvVar(key: string, defaultValue: boolean): boolean {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function getOptionalMessageFormatModeEnvVar(
  key: string,
  defaultValue: MessageFormatMode,
): MessageFormatMode {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "raw" || normalized === "markdown") {
    return normalized;
  }

  return defaultValue;
}

function getCommaSeparatedIntsEnvVar(key: string): number[] {
  const value = getEnvVar(key, false);
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((s) => {
      const trimmed = s.trim();
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isNaN(parsed) ? NaN : parsed;
    })
    .filter((n) => !Number.isNaN(n));
}

export const config = {
  telegram: {
    token: getEnvVar("TELEGRAM_BOT_TOKEN"),
    allowedUserIds: getCommaSeparatedIntsEnvVar("TELEGRAM_ALLOWED_USER_IDS"),
    allowedChatIds: getCommaSeparatedIntsEnvVar("TELEGRAM_ALLOWED_CHAT_IDS"),
    proxyUrl: getEnvVar("TELEGRAM_PROXY_URL", false),
  },
  redis: {
    url: getEnvVar("REDIS_URL", false) || "redis://localhost:6379",
  },
  superUserIds: new Set(getCommaSeparatedIntsEnvVar("TELEGRAM_SUPER_USER_IDS")),
  opencode: {
    apiUrl: getEnvVar("OPENCODE_API_URL", false) || "http://localhost:4097",
    apiKey: getEnvVar("OPENCODE_API_KEY", false),
    username: getEnvVar("OPENCODE_SERVER_USERNAME", false) || "opencode",
    password: getEnvVar("OPENCODE_SERVER_PASSWORD", false),
    model: {
      provider: getEnvVar("OPENCODE_MODEL_PROVIDER", true),
      modelId: getEnvVar("OPENCODE_MODEL_ID", true),
    },
  },
  server: {
    logLevel: getEnvVar("LOG_LEVEL", false) || "info",
  },
  bot: {
    sessionsListLimit: getOptionalPositiveIntEnvVar("SESSIONS_LIST_LIMIT", 10),
    projectsListLimit: getOptionalPositiveIntEnvVar("PROJECTS_LIST_LIMIT", 10),
    commandsListLimit: getOptionalPositiveIntEnvVar("COMMANDS_LIST_LIMIT", 10),
    taskLimit: getOptionalPositiveIntEnvVar("TASK_LIMIT", 10),
    locale: getOptionalLocaleEnvVar("BOT_LOCALE", "en"),
    serviceMessagesIntervalSec: getOptionalNonNegativeIntEnvVarFromKeys(
      ["SERVICE_MESSAGES_INTERVAL_SEC", "TOOL_MESSAGES_INTERVAL_SEC"],
      5,
    ),
    hideThinkingMessages: getOptionalBooleanEnvVar("HIDE_THINKING_MESSAGES", false),
    hideToolCallMessages: getOptionalBooleanEnvVar("HIDE_TOOL_CALL_MESSAGES", false),
    hideToolFileMessages: getOptionalBooleanEnvVar("HIDE_TOOL_FILE_MESSAGES", false),
    responseStreaming: getOptionalBooleanEnvVar("RESPONSE_STREAMING", true),
    messageFormatMode: getOptionalMessageFormatModeEnvVar("MESSAGE_FORMAT_MODE", "markdown"),
    maxConcurrentChats: getOptionalPositiveIntEnvVar("MAX_CONCURRENT_CHATS", 3),
    rateLimitWindowMs: getOptionalPositiveIntEnvVar("RATE_LIMIT_WINDOW_MS", 60_000),
    rateLimitMessages: getOptionalPositiveIntEnvVar("RATE_LIMIT_MESSAGES", 30),
  },
  files: {
    maxFileSizeKb: parseInt(getEnvVar("CODE_FILE_MAX_SIZE_KB", false) || "100", 10),
  },
  stt: {
    apiUrl: getEnvVar("STT_API_URL", false),
    apiKey: getEnvVar("STT_API_KEY", false),
    model: getEnvVar("STT_MODEL", false) || "whisper-large-v3-turbo",
    language: getEnvVar("STT_LANGUAGE", false),
  },
  tts: {
    enabled: getOptionalBooleanEnvVar("TTS_ENABLED", false),
    apiUrl: getEnvVar("TTS_API_URL", false),
    apiKey: getEnvVar("TTS_API_KEY", false),
    model: getEnvVar("TTS_MODEL", false) || "gpt-4o-mini-tts",
    voice: getEnvVar("TTS_VOICE", false) || "alloy",
  },
  journal: {
    pollIntervalSec: getOptionalPositiveIntEnvVar("JOURNAL_POLL_INTERVAL_SEC", 10),
  },
  watchdog: {
    enabled: getOptionalBooleanEnvVar("OPENCODE_WATCHDOG_ENABLED", true),
    intervalSec: getOptionalPositiveIntEnvVar("OPENCODE_WATCHDOG_INTERVAL_SEC", 30),
    maxRestarts: getOptionalPositiveIntEnvVar("OPENCODE_WATCHDOG_MAX_RESTARTS", 3),
  },
};
