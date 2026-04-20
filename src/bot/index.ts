import { Bot, Context, InputFile, NextFunction } from "grammy";
import { sequentialize } from "@grammyjs/runner";
import { promises as fs } from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { interactionGuardMiddleware } from "./middleware/interaction-guard.js";
import { unknownCommandMiddleware } from "./middleware/unknown-command.js";
import { BOT_COMMANDS } from "./commands/definitions.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { statusCommand } from "./commands/status.js";
import { shellCommand, handleShellCallback } from "./commands/shell.js";
import { sandboxCommand } from "./commands/sandbox.js";
import { costCommand } from "./commands/cost.js";
import { feCommand } from "./commands/fe.js";
import { exportCommand } from "./commands/export.js";
import { lsCommand } from "./commands/ls.js";
import { readCommand } from "./commands/read.js";
import { tasksCommand } from "./commands/tasks.js";
import { logsCommand } from "./commands/logs.js";
import { healthCommand } from "./commands/health.js";
import { journalCommand } from "./commands/journal.js";
import { handleJournalCallback } from "../monitoring/journal-monitor.js";
import { initializeSystemMonitoring, startSystemMonitoring } from "../monitoring/system-monitor.js";
import { initializeTaskTracking, recoverInterruptedTasks } from "../task-queue/tracker.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "./message-patterns.js";
import { sessionsCommand, handleSessionSelect } from "./commands/sessions.js";
import { newCommand } from "./commands/new.js";
import { projectsCommand, handleProjectSelect } from "./commands/projects.js";
import { abortCommand } from "./commands/abort.js";
import { steerCommand } from "./commands/steer.js";
import { opencodeStartCommand } from "./commands/opencode-start.js";
import { opencodeStopCommand } from "./commands/opencode-stop.js";
import { renameCommand, handleRenameCancel, handleRenameTextAnswer } from "./commands/rename.js";
import { handleTaskCallback, handleTaskTextInput, taskCommand } from "./commands/task.js";
import { handleTaskListCallback, taskListCommand } from "./commands/tasklist.js";
import {
  commandsCommand,
  handleCommandsCallback,
  handleCommandTextArguments,
} from "./commands/commands.js";
import { messagesCommand, handleMessagesCallback } from "./commands/messages.js";
import { skillsCommand, handleSkillsCallback } from "./commands/skills.js";
import { mcpsCommand, handleMcpsCallback } from "./commands/mcps.js";
import { modelsCommand } from "./commands/models.js";
import { compactCommand } from "./commands/compact.js";
import { ttsCommand } from "./commands/tts.js";
import { branchCommand } from "./commands/branch.js";
import { commitCommand } from "./commands/commit.js";
import { diffCommand } from "./commands/diff.js";
import {
  handleQuestionCallback,
  showCurrentQuestion,
  handleQuestionTextAnswer,
} from "./handlers/question.js";
import {
  handleInlineQuery,
  handleInlineRunCallback,
  detectInlineCommand,
  detectInlineCommandWithoutColon,
  INLINE_COMMANDS,
} from "./handlers/inline-query.js";
import { handlePermissionCallback } from "./handlers/permission.js";
import { handleAgentSelect, showAgentSelectionMenu } from "./handlers/agent.js";
import { handleModelSelect, showModelSelectionMenu } from "./handlers/model.js";
import { handleVariantSelect, showVariantSelectionMenu } from "./handlers/variant.js";
import { handleContextButtonPress, handleCompactConfirm } from "./handlers/context.js";
import { handleInlineMenuCancel } from "./handlers/inline-menu.js";
import { questionManager } from "../question/manager.js";
import { interactionManager } from "../interaction/manager.js";
import { clearAllInteractionState, clearPromptInteractionState } from "../interaction/cleanup.js";
import { keyboardManager } from "../keyboard/manager.js";
import { subscribeToEvents } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import {
  formatSummary,
  formatSummaryWithMode,
  formatToolInfo,
  getAssistantParseMode,
} from "../summary/formatter.js";
import { ToolMessageBatcher, shouldDisplayToolMessage } from "../summary/tool-message-batcher.js";
import { getCurrentSession } from "../session/manager.js";
import {
  setAssistantRunState,
  getAssistantRunState,
  clearAssistantRunState,
} from "./assistant-run-state.js";
import { formatAssistantRunFooter } from "./utils/assistant-run-footer.js";
import {
  getCurrentProject,
  setCurrentProject,
  getCurrentModel,
  setCurrentModel,
} from "../settings/manager.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { withTelegramRateLimitRetry } from "../utils/telegram-rate-limit-retry.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { t } from "../i18n/index.js";
import { processUserPrompt } from "./handlers/prompt.js";
import { handleVoiceMessage } from "./handlers/voice.js";
import { handleDocumentMessage } from "./handlers/document.js";
import { downloadTelegramFile, toDataUri } from "./utils/file-download.js";
import { finalizeAssistantResponse } from "./utils/finalize-assistant-response.js";
import { deliverThinkingMessage } from "./utils/thinking-message.js";
import { clearLoadingMessage, hasLoadingMessage } from "./utils/loading-messages.js";
import { getDraftId, clearDraftId } from "./utils/draft-messages.js";
import { sendBotText } from "./utils/telegram-text.js";
import { getModelCapabilities, supportsInput } from "../model/capabilities.js";
import { getStoredModel } from "../model/manager.js";
import { sendTtsResponse } from "./utils/send-tts-response.js";
import {
  trackChatUser,
  getUserIdForChat,
  isSuperUser,
  isDangerousPermission,
} from "./utils/user-tracker.js";
import {
  getUserProjectRestriction,
  createFallbackProjectInfo,
  ensureUserProjectDirectory,
  getUserModelVariant,
  isSimpleUser,
} from "../users/access.js";
import { opencodeClient } from "../opencode/client.js";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { foregroundSessionState } from "../scheduled-task/foreground-state.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { ResponseStreamer } from "./streaming/response-streamer.js";
import type { StreamingMessagePayload } from "./streaming/response-streamer.js";
import { ToolCallStreamer } from "./streaming/tool-call-streamer.js";
import {
  editMessageWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./utils/send-with-markdown-fallback.js";
import {
  handleLlmQueryText,
  handleLlmConfirmCallback,
  handleLlmCommandRequest,
} from "./utils/llm-command.js";
import {
  startWorker,
  setTelegramBotApi,
  initQueue,
  addTaskJob,
  type TelegramBotApi,
} from "../queue/index.js";
import { randomUUID } from "crypto";

let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;
const commandsInitializedChats = new Set<number>();
let draftTimer: NodeJS.Timeout | null = null;
const sessionCompletionTasks = new Map<string, Promise<void>>();

// Track group chats that requested a hit-and-run answer — bot leaves after response completes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const chatsToLeaveAfterAnswer = new Set<number>(); // kept for future group-mode use

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;
const RESPONSE_STREAM_THROTTLE_MS = 200;
const DRAFT_THROTTLE_MS = 150; // Slightly faster than edit throttle, conservative start
const RESPONSE_STREAM_TEXT_LIMIT = 3800;
const SESSION_RETRY_PREFIX = "🔁";
const TEMP_DIR = path.join(tmpdir(), "opencode-outpost");
const SIMPLE_USER_COMMANDS = [
  { command: "new", description: "Start new chat" },
  { command: "abort", description: "Stop response" },
  { command: "sessions", description: "List sessions" },
  { command: "skills", description: "Browse skills" },
  { command: "help", description: "Help" },
];

function getCurrentReplyKeyboard(chatId: number): ReturnType<typeof keyboardManager.getKeyboard> {
  const userId = getUserIdForChat(chatId);
  if (userId != null && isSimpleUser(userId)) {
    return undefined;
  }

  if (!keyboardManager.isInitialized(chatId)) {
    return undefined;
  }

  return keyboardManager.getKeyboard(chatId);
}

function isSimpleModeChat(chatId: number): boolean {
  const userId = getUserIdForChat(chatId);
  return userId != null && isSimpleUser(userId);
}

function prepareDocumentCaption(caption: string): string {
  const normalizedCaption = caption.trim();
  if (!normalizedCaption) {
    return "";
  }

  if (normalizedCaption.length <= TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH) {
    return normalizedCaption;
  }

  return `${normalizedCaption.slice(0, TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH - 3)}...`;
}

function prepareStreamingPayload(messageText: string): StreamingMessagePayload | null {
  const parts = formatSummaryWithMode(
    messageText,
    config.bot.messageFormatMode,
    RESPONSE_STREAM_TEXT_LIMIT,
  );
  if (parts.length === 0) {
    return null;
  }

  return {
    parts,
    format: config.bot.messageFormatMode === "markdown" ? "markdown_v2" : "raw",
  };
}

const toolMessageBatcher = new ToolMessageBatcher({
  intervalSeconds: 5,
  sendText: async (sessionId, text) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    const keyboard = getCurrentReplyKeyboard(chatIdInstance!);
    const api = botInstance!.api;
    const chatId = chatIdInstance!;

    await withTelegramRateLimitRetry(
      () =>
        api.sendMessage(chatId, text, {
          disable_notification: true,
          ...(keyboard ? { reply_markup: keyboard } : {}),
        }),
      "toolBatch.send",
    );
  },
  sendFile: async (sessionId, fileData) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    const tempFilePath = path.join(TEMP_DIR, fileData.filename);

    try {
      logger.debug(
        `[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes, session=${sessionId})`,
      );

      await fs.mkdir(TEMP_DIR, { recursive: true });
      await fs.writeFile(tempFilePath, fileData.buffer);

      const keyboard = getCurrentReplyKeyboard(chatIdInstance!);

      await botInstance.api.sendDocument(chatIdInstance, new InputFile(tempFilePath), {
        caption: fileData.caption,
        disable_notification: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  },
});

const responseStreamer = new ResponseStreamer({
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
  sendText: async (text, format, options) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for streamed send");
    }

    const parseMode = format === "markdown_v2" ? "MarkdownV2" : undefined;
    const api = botInstance.api;
    const chatId = chatIdInstance;
    const sentMessage = await withTelegramRateLimitRetry(
      () =>
        sendMessageWithMarkdownFallback({
          api,
          chatId,
          text,
          options,
          parseMode,
        }),
      "responseStream.send",
    );

    return sentMessage.message_id;
  },
  editText: async (messageId, text, format, options) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for streamed edit");
    }

    const parseMode = format === "markdown_v2" ? "MarkdownV2" : undefined;
    const api = botInstance.api;
    const chatId = chatIdInstance;

    try {
      await withTelegramRateLimitRetry(
        () =>
          editMessageWithMarkdownFallback({
            api,
            chatId,
            messageId,
            text,
            options,
            parseMode,
          }),
        "responseStream.edit",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (errorMessage.includes("message is not modified")) {
        return;
      }

      throw error;
    }
  },
  deleteText: async (messageId) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for streamed delete");
    }

    await botInstance.api.deleteMessage(chatIdInstance, messageId).catch((error) => {
      const errorMessage =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        errorMessage.includes("message to delete not found") ||
        errorMessage.includes("message identifier is not specified")
      ) {
        return;
      }

      throw error;
    });
  },
});

const toolCallStreamer = new ToolCallStreamer({
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
  sendText: async (sessionId, text) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for tool stream send");
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      throw new Error(`Tool stream session mismatch for send: ${sessionId}`);
    }

    const sentMessage = await botInstance.api.sendMessage(chatIdInstance, text, {
      disable_notification: true,
    });

    return sentMessage.message_id;
  },
  editText: async (sessionId, messageId, text) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for tool stream edit");
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      throw new Error(`Tool stream session mismatch for edit: ${sessionId}`);
    }

    try {
      await botInstance.api.editMessageText(chatIdInstance, messageId, text);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (errorMessage.includes("message is not modified")) {
        return;
      }

      throw error;
    }
  },
  deleteText: async (sessionId, messageId) => {
    if (!botInstance || !chatIdInstance || chatIdInstance <= 0) {
      throw new Error("Bot context missing for tool stream delete");
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      throw new Error(`Tool stream session mismatch for delete: ${sessionId}`);
    }

    await botInstance.api.deleteMessage(chatIdInstance, messageId).catch((error) => {
      const errorMessage =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (
        errorMessage.includes("message to delete not found") ||
        errorMessage.includes("message identifier is not specified")
      ) {
        return;
      }

      throw error;
    });
  },
});

async function ensureCommandsInitialized(ctx: Context, next: NextFunction): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !ctx.from || !config.telegram.allowedUserIds.includes(ctx.from.id)) {
    await next();
    return;
  }

  if (commandsInitializedChats.has(chatId)) {
    await next();
    return;
  }

  try {
    const userId = ctx.from.id;
    const commands = isSimpleUser(userId) ? SIMPLE_USER_COMMANDS : BOT_COMMANDS;

    await ctx.api.setMyCommands(commands, {
      scope: {
        type: "chat",
        chat_id: chatId,
      },
    });

    commandsInitializedChats.add(chatId);
    logger.debug(
      `[Bot] Commands initialized for chat_id=${chatId}, simple=${isSimpleUser(userId)}`,
    );
  } catch (err) {
    logger.error("[Bot] Failed to set commands:", err);
  }

  await next();
}

async function ensureEventSubscription(directory: string): Promise<void> {
  if (!directory) {
    logger.error("No directory found for event subscription");
    return;
  }

  toolMessageBatcher.setIntervalSeconds(config.bot.serviceMessagesIntervalSec);
  summaryAggregator.setTypingIndicatorEnabled(true);
  summaryAggregator.setOnCleared(() => {
    toolMessageBatcher.clearAll("summary_aggregator_clear");
    toolCallStreamer.clearAll("summary_aggregator_clear");
    responseStreamer.clearAll("summary_aggregator_clear");
  });

  summaryAggregator.setOnPartial((sessionId, messageId, messageText) => {
    if (!config.bot.responseStreaming) {
      return;
    }

    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    if (hasLoadingMessage(sessionId) && botInstance) {
      void clearLoadingMessage(sessionId, botInstance.api, "streaming_started");
    }

    // Send live draft update
    const draftId = chatIdInstance ? getDraftId(chatIdInstance) : undefined;
    if (draftId && botInstance && chatIdInstance) {
      // Debounce draft updates to avoid rate limiting
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        if (!botInstance || !chatIdInstance) return;
        void botInstance.api.sendMessageDraft(chatIdInstance, draftId, messageText).catch((err) => {
          // Non-fatal - draft is visual feedback only
          logger.debug("[Bot] sendMessageDraft error (non-fatal):", err);
        });
      }, DRAFT_THROTTLE_MS);
    }

    const preparedStreamPayload = prepareStreamingPayload(messageText);
    if (!preparedStreamPayload) {
      return;
    }

    preparedStreamPayload.sendOptions = undefined;
    preparedStreamPayload.editOptions = undefined;

    responseStreamer.enqueue(sessionId, messageId, preparedStreamPayload);
  });

  summaryAggregator.setOnComplete(async (sessionId, messageId, messageText) => {
    if (sessionCompletionTasks.has(sessionId)) {
      logger.warn(`[Bot] Re-entrant completion detected for session=${sessionId}, skipping`);
      return;
    }

    const task = (async () => {
      try {
        if (!botInstance || !chatIdInstance) {
          logger.error("Bot or chat ID not available for sending message");
          responseStreamer.clearMessage(sessionId, messageId, "bot_context_missing");
          toolCallStreamer.clearSession(sessionId, "bot_context_missing");
          clearPromptInteractionState(chatIdInstance ?? 0, "prompt_completed_no_context");
          if (chatIdInstance) {
            clearDraftId(chatIdInstance);
          }
          foregroundSessionState.markIdle(sessionId);
          return;
        }

        const currentSession = getCurrentSession(chatIdInstance!);
        if (currentSession?.id !== sessionId) {
          responseStreamer.clearMessage(sessionId, messageId, "session_mismatch");
          toolCallStreamer.clearSession(sessionId, "session_mismatch");
          clearPromptInteractionState(chatIdInstance ?? 0, "prompt_completed_session_mismatch");
          if (chatIdInstance) {
            clearDraftId(chatIdInstance);
          }
          foregroundSessionState.markIdle(sessionId);
          await scheduledTaskRuntime.flushDeferredDeliveries();
          return;
        }

        const botApi = botInstance.api;
        const chatId = chatIdInstance;

        const runState = getAssistantRunState(sessionId);
        if (runState?.agentId && runState?.modelId && runState?.provider) {
          const elapsed = Date.now() - runState.startedAt;
          const footer = formatAssistantRunFooter({
            agent: runState.agentId,
            providerID: runState.provider,
            modelID: runState.modelId,
            elapsedMs: elapsed,
          });
          messageText = `${messageText}\n\n${footer}`;
        }

        // 1. Send the final assistant message
        const streamedViaMessages = await finalizeAssistantResponse({
          responseStreaming: config.bot.responseStreaming,
          sessionId,
          messageId,
          messageText,
          responseStreamer,
          flushPendingServiceMessages: () =>
            Promise.all([
              toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
              toolCallStreamer.flushSession(sessionId, "assistant_message_completed"),
            ]).then(() => undefined),
          prepareStreamingPayload,
          formatSummary,
          resolveFormat: () => (getAssistantParseMode() === "MarkdownV2" ? "markdown_v2" : "raw"),
          getReplyKeyboard: () => getCurrentReplyKeyboard(chatId),
          sendText: async (text, options, format) => {
            await sendBotText({
              api: botApi,
              chatId,
              text,
              options: options as Parameters<typeof sendBotText>[0]["options"],
              format,
            });
          },
        });

        if (streamedViaMessages) {
          logger.debug(
            `[Bot] Final assistant message already streamed (session=${sessionId}, message=${messageId})`,
          );
        }

        // TTS: serialized per-chat in the completion chain (not fire-and-forget)
        // If TTS fails, log and continue — don't let TTS failure block the chain
        try {
          await sendTtsResponse(botApi, chatId, messageText);
        } catch (err) {
          logger.error("[TTS] Auto-reply error:", err);
        }
      } catch (err) {
        logger.error("Failed to send message to Telegram:", err);
        logger.error("[Bot] CRITICAL: Stopping event processing due to error");
        summaryAggregator.clear();
      } finally {
        foregroundSessionState.markIdle(sessionId);
        clearAssistantRunState(sessionId);
        clearPromptInteractionState(chatIdInstance ?? 0, "prompt_completed");

        if (chatIdInstance) {
          clearDraftId(chatIdInstance);
        }

        await scheduledTaskRuntime.flushDeferredDeliveries();
      }
    })();

    sessionCompletionTasks.set(sessionId, task);
    await task;
  });

  summaryAggregator.setOnTool(async (toolInfo) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== toolInfo.sessionId) {
      return;
    }

    const shouldIncludeToolInfoInFileCaption =
      toolInfo.hasFileAttachment &&
      (toolInfo.tool === "write" || toolInfo.tool === "edit" || toolInfo.tool === "apply_patch");

    if (config.bot.hideToolCallMessages || shouldIncludeToolInfoInFileCaption) {
      return;
    }

    try {
      const message = formatToolInfo(toolInfo);
      if (message) {
        toolCallStreamer.append(toolInfo.sessionId, message, toolInfo.tool);
      }
    } catch (err) {
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

  summaryAggregator.setOnToolFile(async (fileInfo) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for sending file");
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== fileInfo.sessionId) {
      return;
    }

    try {
      await toolCallStreamer.breakSession(fileInfo.sessionId, "tool_file_boundary");

      if (!shouldDisplayToolMessage(fileInfo.tool)) {
        logger.debug(
          `[Bot] Skipping tool file message for ${fileInfo.tool} (hideToolFileMessages=true)`,
        );
        return;
      }

      const toolMessage = formatToolInfo(fileInfo);
      const caption = prepareDocumentCaption(toolMessage || fileInfo.fileData.caption);

      toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
        ...fileInfo.fileData,
        caption,
      });
    } catch (err) {
      logger.error("Failed to send file to Telegram:", err);
    }
  });

  summaryAggregator.setOnQuestion(async (questions, requestID) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for showing questions");
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (currentSession) {
      await Promise.all([
        toolMessageBatcher.flushSession(currentSession.id, "question_asked"),
        toolCallStreamer.flushSession(currentSession.id, "question_asked"),
      ]);
    }

    if (questionManager.isActive(chatIdInstance!)) {
      logger.warn("[Bot] Replacing active poll with a new one");

      const previousMessageIds = questionManager.getMessageIds(chatIdInstance!);
      for (const messageId of previousMessageIds) {
        await botInstance.api.deleteMessage(chatIdInstance, messageId).catch(() => {});
      }

      clearAllInteractionState(chatIdInstance!, "question_replaced_by_new_poll");
    }

    logger.info(`[Bot] Received ${questions.length} questions from agent, requestID=${requestID}`);
    questionManager.startQuestions(chatIdInstance!, questions, requestID);
    await showCurrentQuestion(botInstance.api, chatIdInstance);
  });

  summaryAggregator.setOnQuestionError(async () => {
    logger.info(`[Bot] Question tool failed, clearing active poll and deleting messages`);

    // Delete all messages from the invalid poll
    const messageIds = questionManager.getMessageIds(chatIdInstance!);
    for (const messageId of messageIds) {
      if (chatIdInstance) {
        await botInstance?.api.deleteMessage(chatIdInstance, messageId).catch((err) => {
          logger.error(`[Bot] Failed to delete question message ${messageId}:`, err);
        });
      }
    }

    clearAllInteractionState(chatIdInstance!, "question_error");
  });

  summaryAggregator.setOnPermission(async (request) => {
    if (!botInstance || !chatIdInstance) {
      logger.error("Bot or chat ID not available for showing permission request");
      return;
    }

    await Promise.all([
      toolMessageBatcher.flushSession(request.sessionID, "permission_asked"),
      toolCallStreamer.flushSession(request.sessionID, "permission_asked"),
    ]);

    logger.info(
      `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}`,
    );

    // Super user permission system
    const currentUserId = getUserIdForChat(chatIdInstance);
    const isSuper = currentUserId !== null && isSuperUser(currentUserId);

    if (isSuper) {
      // Super user: auto-approve all permissions
      logger.info(
        `[Permission] Auto-approving (super user): type=${request.permission}, userId=${currentUserId}`,
      );
      safeBackgroundTask({
        taskName: "permission.auto_approve_superuser",
        task: () =>
          opencodeClient.permission.reply({
            requestID: request.id,
            directory: getCurrentSession(chatIdInstance!)?.directory ?? "",
            reply: "always",
          }),
        onSuccess: ({ error }) => {
          if (error) {
            logger.error("[Permission] Auto-approve failed:", error);
          }
        },
      });
      return;
    }

    // Regular user check
    const isDangerous = isDangerousPermission(request.permission);
    const directory = getCurrentSession(chatIdInstance!)?.directory ?? "";

    if (isDangerous) {
      // Dangerous permission for regular user: auto-reject + notify
      logger.warn(
        `[Permission] Rejecting dangerous permission for non-super user: type=${request.permission}, userId=${currentUserId}`,
      );
      safeBackgroundTask({
        taskName: "permission.auto_reject_regular",
        task: () =>
          opencodeClient.permission.reply({
            requestID: request.id,
            directory,
            reply: "reject",
          }),
      });
      await botInstance.api
        .sendMessage(chatIdInstance, t("permission.denied.super_user_only"))
        .catch(() => {});
      return;
    }

    // Safe permission for regular user: auto-approve once
    logger.info(
      `[Permission] Auto-approving safe permission: type=${request.permission}, userId=${currentUserId}`,
    );
    safeBackgroundTask({
      taskName: "permission.auto_approve_safe",
      task: () =>
        opencodeClient.permission.reply({
          requestID: request.id,
          directory,
          reply: "once",
        }),
      onSuccess: ({ error }) => {
        if (error) {
          logger.error("[Permission] Auto-approve safe failed:", error);
        }
      },
    });
  });

  summaryAggregator.setOnThinking(async (sessionId) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    logger.debug("[Bot] Agent started thinking");

    await toolCallStreamer.breakSession(sessionId, "thinking_started");

    deliverThinkingMessage(sessionId, toolMessageBatcher, {
      responseStreaming: config.bot.responseStreaming,
      hideThinkingMessages: config.bot.hideThinkingMessages,
    });
  });

  summaryAggregator.setOnThinkingUpdate((text) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession) {
      return;
    }

    logger.debug(`[Bot] Subagent status update: ${text.replace(/\n/g, " | ")}`);

    toolCallStreamer.replaceByPrefix(currentSession.id, "🤖", text);
  });

  summaryAggregator.setOnTokens(async (tokens) => {
    if (isSimpleModeChat(chatIdInstance!)) {
      return;
    }

    if (!pinnedMessageManager.isInitialized(chatIdInstance!)) {
      return;
    }

    try {
      logger.debug(`[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}`);

      const contextSize = tokens.input + tokens.cacheRead;
      const contextLimit = pinnedMessageManager.getContextLimit(chatIdInstance!);
      if (contextLimit > 0) {
        keyboardManager.updateContext(chatIdInstance!, contextSize, contextLimit);
      }

      await pinnedMessageManager.onMessageComplete(chatIdInstance!, tokens);
    } catch (err) {
      logger.error("[Bot] Error updating pinned message with tokens:", err);
    }
  });

  summaryAggregator.setOnCost(async (cost) => {
    if (isSimpleModeChat(chatIdInstance!)) {
      return;
    }

    if (!pinnedMessageManager.isInitialized(chatIdInstance!)) {
      return;
    }

    try {
      logger.debug(`[Bot] Cost update: $${cost.toFixed(2)}`);
      await pinnedMessageManager.onCostUpdate(chatIdInstance!, cost);
    } catch (err) {
      logger.error("[Bot] Error updating cost:", err);
    }
  });

  summaryAggregator.setOnSessionCompacted(async (sessionId, directory) => {
    if (isSimpleModeChat(chatIdInstance!)) {
      return;
    }

    if (!pinnedMessageManager.isInitialized(chatIdInstance!)) {
      return;
    }

    try {
      logger.info(`[Bot] Session compacted, reloading context: ${sessionId}`);
      await pinnedMessageManager.onSessionCompacted(chatIdInstance!, sessionId, directory);
    } catch (err) {
      logger.error("[Bot] Error reloading context after compaction:", err);
    }
  });

  summaryAggregator.setOnSessionError(async (sessionId, message) => {
    if (!botInstance || !chatIdInstance) {
      foregroundSessionState.markIdle(sessionId);
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      responseStreamer.clearSession(sessionId, "session_error_not_current");
      toolCallStreamer.clearSession(sessionId, "session_error_not_current");
      foregroundSessionState.markIdle(sessionId);
      await scheduledTaskRuntime.flushDeferredDeliveries();
      return;
    }

    responseStreamer.clearSession(sessionId, "session_error");
    if (hasLoadingMessage(sessionId)) {
      void clearLoadingMessage(sessionId, botInstance.api, "session_error");
    }

    await Promise.all([
      toolMessageBatcher.flushSession(sessionId, "session_error"),
      toolCallStreamer.flushSession(sessionId, "session_error"),
    ]);

    const normalizedMessage = message.trim() || t("common.unknown_error");
    const truncatedMessage =
      normalizedMessage.length > 3500
        ? `${normalizedMessage.slice(0, 3497)}...`
        : normalizedMessage;

    await botInstance.api
      .sendMessage(chatIdInstance, t("bot.session_error", { message: truncatedMessage }))
      .catch((err) => {
        logger.error("[Bot] Failed to send session.error message:", err);
      });

    foregroundSessionState.markIdle(sessionId);
    clearAssistantRunState(sessionId);
    clearPromptInteractionState(chatIdInstance ?? 0, "session_error");
    await scheduledTaskRuntime.flushDeferredDeliveries();
  });

  summaryAggregator.setOnSessionRetry(async ({ sessionId, message }) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession(chatIdInstance!);
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    if (hasLoadingMessage(sessionId)) {
      void clearLoadingMessage(sessionId, botInstance.api, "session_retry");
    }

    const normalizedMessage = message.trim() || t("common.unknown_error");
    const truncatedMessage =
      normalizedMessage.length > 3500
        ? `${normalizedMessage.slice(0, 3497)}...`
        : normalizedMessage;

    const retryMessage = t("bot.session_retry", { message: truncatedMessage });
    toolCallStreamer.replaceByPrefix(sessionId, SESSION_RETRY_PREFIX, retryMessage);
  });

  summaryAggregator.setOnSessionDiff(async (_sessionId, diffs) => {
    if (isSimpleModeChat(chatIdInstance!)) {
      return;
    }

    if (!pinnedMessageManager.isInitialized(chatIdInstance!)) {
      return;
    }

    try {
      await pinnedMessageManager.onSessionDiff(chatIdInstance!, diffs);
    } catch (err) {
      logger.error("[Bot] Error updating session diff:", err);
    }
  });

  summaryAggregator.setOnFileChange((change) => {
    if (isSimpleModeChat(chatIdInstance!)) {
      return;
    }

    if (!pinnedMessageManager.isInitialized(chatIdInstance!)) {
      return;
    }
    pinnedMessageManager.addFileChange(chatIdInstance!, change);
  });

  pinnedMessageManager.setOnKeyboardUpdate(async (tokensUsed, tokensLimit) => {
    if (isSimpleModeChat(chatIdInstance!)) {
      return;
    }

    try {
      logger.debug(`[Bot] Updating keyboard with context: ${tokensUsed}/${tokensLimit}`);
      keyboardManager.updateContext(chatIdInstance!, tokensUsed, tokensLimit);
      // Don't send automatic keyboard updates - keyboard will update naturally with user messages
    } catch (err) {
      logger.error("[Bot] Error updating keyboard context:", err);
    }
  });

  logger.info(`[Bot] Subscribing to OpenCode events for project: ${directory}`);
  subscribeToEvents(directory, (event) => {
    if (event.type === "session.created" || event.type === "session.updated") {
      const info = (
        event.properties as { info?: { directory?: string; time?: { updated?: number } } }
      ).info;

      if (info?.directory) {
        safeBackgroundTask({
          taskName: `session.cache.${event.type}`,
          task: () => ingestSessionInfoForCache(info),
        });
      }
    }

    if (event.type === "message.updated") {
      const { info: msgInfo } = event.properties as {
        info: {
          role?: string;
          sessionID?: string;
          agent?: string;
          modelID?: string;
          providerID?: string;
        };
      };

      if (msgInfo?.role === "assistant" && msgInfo.sessionID) {
        setAssistantRunState(msgInfo.sessionID, {
          agentId: msgInfo.agent ?? null,
          modelId: msgInfo.modelID ?? null,
          provider: msgInfo.providerID ?? null,
        });
      }
    }

    summaryAggregator.processEvent(event);
  }).catch((err) => {
    logger.error("Failed to subscribe to events:", err);
  });
}

export async function createBot(): Promise<Bot<Context>> {
  clearAllInteractionState(chatIdInstance ?? 0, "bot_startup");
  toolMessageBatcher.setIntervalSeconds(config.bot.serviceMessagesIntervalSec);
  logger.debug(
    `[ToolBatcher] Service messages interval: ${config.bot.serviceMessagesIntervalSec}s`,
  );

  const botOptions: ConstructorParameters<typeof Bot<Context>>[1] = {};

  if (config.telegram.proxyUrl) {
    const proxyUrl = config.telegram.proxyUrl;
    let agent;

    if (proxyUrl.startsWith("socks")) {
      agent = new SocksProxyAgent(proxyUrl);
      logger.info(`[Bot] Using SOCKS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    } else {
      agent = new HttpsProxyAgent(proxyUrl);
      logger.info(`[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    }

    botOptions.client = {
      baseFetchConfig: {
        agent,
        compress: true,
      },
    };
  }

  const bot = new Bot(config.telegram.token, botOptions);

  bot.use(sequentialize((ctx) => ctx.chat?.id.toString() ?? ""));

  setTelegramBotApi(bot.api as unknown as TelegramBotApi);
  await initQueue();
  startWorker().catch((err) =>
    logger.warn("[Bot] BullMQ worker disabled (Redis unavailable):", err),
  );

  // Initialize task tracking for persistence
  initializeTaskTracking(bot);
  recoverInterruptedTasks();

  // Initialize system monitoring
  initializeSystemMonitoring(bot);
  startSystemMonitoring({
    userId: config.telegram.allowedUserIds[0],
    checkIntervalMinutes: 5,
  });

  // Heartbeat for diagnostics: verify the event loop is not blocked
  let heartbeatCounter = 0;
  setInterval(() => {
    heartbeatCounter++;
    if (heartbeatCounter % 6 === 0) {
      // Log every 30 seconds (5 sec * 6)
      logger.debug(`[Bot] Heartbeat #${heartbeatCounter} - event loop alive`);
    }
  }, 5000);

  // Log all API calls for diagnostics
  let lastGetUpdatesTime = Date.now();
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "getUpdates") {
      const now = Date.now();
      const timeSinceLast = now - lastGetUpdatesTime;
      logger.debug(`[Bot API] getUpdates called (${timeSinceLast}ms since last)`);
      lastGetUpdatesTime = now;
    } else if (method === "sendMessage") {
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id}`);
    }
    return prev(method, payload, signal);
  });

  bot.use((ctx, next) => {
    const hasCallbackQuery = !!ctx.callbackQuery;
    const hasMessage = !!ctx.message;
    const callbackData = ctx.callbackQuery?.data || "N/A";
    logger.debug(
      `[DEBUG] Incoming update: hasCallbackQuery=${hasCallbackQuery}, hasMessage=${hasMessage}, callbackData=${callbackData}`,
    );

    // Track userId per chatId for permission system
    if (ctx.from?.id && ctx.chat?.id) {
      trackChatUser(ctx.chat.id, ctx.from.id);
    }

    return next();
  });

  // DIAGNOSTIC: Log ALL message:text events BEFORE any middleware
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text || "(no text)";
    const chatType = ctx.chat?.type || "unknown";
    const userId = ctx.from?.id || "unknown";
    const messageId = ctx.message?.message_id || "unknown";
    logger.info(
      `[DIAGNOSTIC] message:text ENTERED chain: text="${text.substring(0, 80)}...", chatType=${chatType}, userId=${userId}, messageId=${messageId}`,
    );
    await next();
    logger.debug(`[DIAGNOSTIC] message:text AFTER middleware chain completed`);
  });

  bot.use(authMiddleware);

  // Auto-select dedicated project and model settings for restricted users after auth passes
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (userId != null && chatId != null) {
      const restriction = getUserProjectRestriction(userId);
      if (restriction) {
        const currentProject = getCurrentProject(chatId);
        const isCorrectProject =
          currentProject?.worktree.toLowerCase().replace(/[\\/]+$/g, "") ===
          restriction.projectPath.toLowerCase().replace(/[\\/]+$/g, "");

        if (!isCorrectProject) {
          try {
            await ensureUserProjectDirectory(userId);
            const { getProjectsForUser: fetchUserProjects } = await import("../project/manager.js");
            const projects = await fetchUserProjects(userId);
            const project = projects[0] ?? createFallbackProjectInfo(userId);
            if (project) {
              setCurrentProject(chatId, project);
              logger.info(
                `[UserAccess] Auto-selected project "${project.name}" for userId=${userId}, chatId=${chatId}`,
              );
            }
          } catch (err) {
            logger.warn(`[UserAccess] Could not auto-select project for userId=${userId}:`, err);
          }
        }

        // Auto-apply the preferred model variant
        const preferredVariant = getUserModelVariant(userId);
        if (preferredVariant) {
          const currentModel = getCurrentModel(chatId);
          if (currentModel?.variant !== preferredVariant) {
            setCurrentModel(chatId, {
              ...(currentModel ?? { providerID: "", modelID: "" }),
              variant: preferredVariant,
            });
            logger.debug(
              `[UserAccess] Auto-set model variant "${preferredVariant}" for userId=${userId}, chatId=${chatId}`,
            );
          }
        }
      }
    }
    return next();
  });
  bot.use(ensureCommandsInitialized);
  bot.on("inline_query", handleInlineQuery);
  bot.use(interactionGuardMiddleware);

  const blockMenuWhileInteractionActive = async (ctx: Context): Promise<boolean> => {
    const activeInteraction = interactionManager.getSnapshot(chatIdInstance!);
    if (!activeInteraction) {
      return false;
    }

    logger.debug(
      `[Bot] Blocking menu open while interaction active: kind=${activeInteraction.kind}, expectedInput=${activeInteraction.expectedInput}`,
    );
    await ctx.reply(t("interaction.blocked.finish_current"));
    return true;
  };

  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.command("status", statusCommand);
  bot.command("opencode_start", opencodeStartCommand);
  bot.command("opencode_stop", opencodeStopCommand);
  bot.command("projects", projectsCommand);
  bot.command("sessions", sessionsCommand);
  bot.command("new", newCommand);
  bot.command("abort", abortCommand);
  bot.command("stop", abortCommand);
  bot.command("steer", async (ctx) => {
    await steerCommand(ctx, { bot, ensureEventSubscription });
  });
  bot.command("task", taskCommand);
  bot.command("tasklist", taskListCommand);
  bot.command("rename", renameCommand);
  bot.command("commands", commandsCommand);
  bot.command("shell", shellCommand);
  bot.command("ls", lsCommand);
  bot.command("read", readCommand);
  bot.command("tasks", tasksCommand);
  bot.command("logs", logsCommand);
  bot.command("health", healthCommand);
  bot.command("journal", journalCommand);
  bot.command("sandbox", sandboxCommand);
  bot.command("cost", costCommand);
  bot.command("fe", feCommand);
  bot.command("export", exportCommand);
  bot.command("messages", messagesCommand);
  bot.command("skills", skillsCommand);
  bot.command("mcps", mcpsCommand);
  bot.command("models", modelsCommand);
  bot.command("compact", compactCommand);
  bot.command("tts", ttsCommand);
  bot.command("branch", branchCommand);
  bot.command("commit", commitCommand);
  bot.command("diff", diffCommand);

  // Register slash command handlers for inline mode commands.
  // When a user taps an inline result (e.g. @bot feynman: some text), the bot
  // sends "/feynman some text" as the message. Slash commands bypass Telegram
  // Group Privacy Mode, so the bot receives them without needing @mention.
  for (const inlineCmd of INLINE_COMMANDS) {
    bot.command(inlineCmd.slashCommand, async (ctx) => {
      const query = (ctx.match as string)?.trim() || undefined;
      await handleLlmCommandRequest(ctx, inlineCmd.slashCommand, query);
    });
  }

  bot.on("message:text", unknownCommandMiddleware);

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    if (ctx.chat) {
      botInstance = bot;
      chatIdInstance = ctx.chat.id;
    }

    try {
      const handledShell = await handleShellCallback(ctx);
      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      const handledSession = await handleSessionSelect(ctx);
      const handledProject = await handleProjectSelect(ctx);
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledTask = await handleTaskCallback(ctx);
      const handledTaskList = await handleTaskListCallback(ctx);
      const handledRenameCancel = await handleRenameCancel(ctx);
      const handledCommands = await handleCommandsCallback(ctx, { bot, ensureEventSubscription });
      const handledMessages = await handleMessagesCallback(ctx);
      const handledSkills = await handleSkillsCallback(ctx);
      const handledMcps = await handleMcpsCallback(ctx);
      const handledJournal = await handleJournalCallback(ctx);
      const handledInlineRun = await handleInlineRunCallback(ctx);
      const handledLlmGuard = await handleLlmConfirmCallback(ctx);

      logger.debug(
        `[Bot] Callback handled: shell=${handledShell}, inlineCancel=${handledInlineCancel}, session=${handledSession}, project=${handledProject}, question=${handledQuestion}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compactConfirm=${handledCompactConfirm}, task=${handledTask}, taskList=${handledTaskList}, rename=${handledRenameCancel}, commands=${handledCommands}, messages=${handledMessages}, skills=${handledSkills}, mcps=${handledMcps}, journal=${handledJournal}, inlineRun=${handledInlineRun}, llmGuard=${handledLlmGuard}`,
      );

      if (
        !handledShell &&
        !handledInlineCancel &&
        !handledSession &&
        !handledProject &&
        !handledQuestion &&
        !handledPermission &&
        !handledAgent &&
        !handledModel &&
        !handledVariant &&
        !handledCompactConfirm &&
        !handledTask &&
        !handledTaskList &&
        !handledRenameCancel &&
        !handledCommands &&
        !handledMessages &&
        !handledSkills &&
        !handledMcps &&
        !handledJournal &&
        !handledInlineRun &&
        !handledLlmGuard
      ) {
        logger.debug("Unknown callback query:", ctx.callbackQuery?.data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      }
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      clearAllInteractionState(chatIdInstance!, "callback_handler_error");
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });

  // Handle Reply Keyboard button press (agent mode indicator)
  bot.hears(AGENT_MODE_BUTTON_TEXT_PATTERN, async (ctx) => {
    if (ctx.from?.id && isSimpleUser(ctx.from.id)) return;
    logger.debug(`[Bot] Agent mode button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showAgentSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing agent menu:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  // Handle Reply Keyboard button press (model selector)
  // Model button text is produced by formatModelForButton() and always starts with "🤖 ".
  bot.hears(MODEL_BUTTON_TEXT_PATTERN, async (ctx) => {
    if (ctx.from?.id && isSimpleUser(ctx.from.id)) return;
    logger.debug(`[Bot] Model button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showModelSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing model menu:", err);
      await ctx.reply(t("error.load_models"));
    }
  });

  // Handle Reply Keyboard button press (context button)
  bot.hears(/^📊(?:\s|$)/, async (ctx) => {
    if (ctx.from?.id && isSimpleUser(ctx.from.id)) return;
    logger.debug(`[Bot] Context button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await handleContextButtonPress(ctx);
    } catch (err) {
      logger.error("[Bot] Error handling context button:", err);
      await ctx.reply(t("error.context_button"));
    }
  });

  // Handle Reply Keyboard button press (variant selector)
  // Keep support for both legacy "💭" and current "💡" prefix.
  bot.hears(VARIANT_BUTTON_TEXT_PATTERN, async (ctx) => {
    if (ctx.from?.id && isSimpleUser(ctx.from.id)) return;

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showVariantSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing variant menu:", err);
      await ctx.reply(t("error.load_variants"));
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text;
    if (text) {
      const isCommand = text.startsWith("/");
      logger.debug(
        `[Bot] Received text message: ${isCommand ? `command="${text}"` : `prompt (length=${text.length})`}, chatId=${ctx.chat.id}`,
      );
    }
    await next();
  });

  // Remove any previously set global commands to prevent unauthorized users from seeing them
  safeBackgroundTask({
    taskName: "bot.clearGlobalCommands",
    task: async () => {
      try {
        await Promise.all([
          bot.api.setMyCommands([], { scope: { type: "default" } }),
          bot.api.setMyCommands([], { scope: { type: "all_private_chats" } }),
        ]);
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error };
      }
    },
    onSuccess: (result) => {
      if (result.success) {
        logger.debug("[Bot] Cleared global commands (default and all_private_chats scopes)");
        return;
      }

      logger.warn("[Bot] Could not clear global commands:", result.error);
    },
  });

  // Voice and audio message handlers (STT transcription -> prompt)
  const voicePromptDeps = { bot, ensureEventSubscription };

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  // Photo message handler
  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);

    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) {
      return;
    }

    const caption = ctx.message.caption || "";

    try {
      // Get the largest photo (last element in array)
      const largestPhoto = photos[photos.length - 1];

      // Check model capabilities
      const storedModel = getStoredModel(ctx.chat.id);
      const capabilities = await getModelCapabilities(storedModel.providerID, storedModel.modelID);

      if (!supportsInput(capabilities, "image")) {
        logger.warn(
          `[Bot] Model ${storedModel.providerID}/${storedModel.modelID} doesn't support image input`,
        );
        await ctx.reply(t("bot.photo_model_no_image"));

        // Fall back to caption-only if present
        if (caption.trim().length > 0) {
          botInstance = bot;
          chatIdInstance = ctx.chat.id;
          const promptDeps = { bot, ensureEventSubscription };
          await processUserPrompt(ctx, caption, promptDeps);
        }
        return;
      }

      // Download photo
      await ctx.reply(t("bot.photo_downloading"));
      const downloadedFile = await downloadTelegramFile(ctx.api, largestPhoto.file_id);

      // Convert to data URI (Telegram always converts photos to JPEG)
      const dataUri = toDataUri(downloadedFile.buffer, "image/jpeg");

      // Create file part
      const filePart: FilePartInput = {
        type: "file",
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: dataUri,
      };

      logger.info(`[Bot] Sending photo (${downloadedFile.buffer.length} bytes) with prompt`);

      botInstance = bot;
      chatIdInstance = ctx.chat.id;

      // Send via processUserPrompt with file part
      const promptDeps = { bot, ensureEventSubscription };
      await processUserPrompt(ctx, caption, promptDeps, [filePart]);
    } catch (err) {
      logger.error("[Bot] Error handling photo message:", err);
      await ctx.reply(t("bot.photo_download_error"));
    }
  });

  // Document message handler (PDF and text files)
  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    const deps = { bot, ensureEventSubscription };
    await handleDocumentMessage(ctx, deps);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    logger.info(
      `[DIAGNOSTIC] Final message:text handler ENTERED: text="${text?.substring(0, 80) || "(no text)"}", chatId=${ctx.chat?.id}, chatType=${ctx.chat?.type}`,
    );
    if (!text) {
      logger.info(`[DIAGNOSTIC] Final_message:text handler: no text, returning`);
      return;
    }

    botInstance = bot;
    chatIdInstance = ctx.chat.id;

    if (text.startsWith("/")) {
      logger.info(`[DIAGNOSTIC] Final_message:text handler: starts with /, returning`);
      return;
    }

    // ── LLM Guard: capture query input when in awaiting_query state ──
    if (await handleLlmQueryText(ctx)) return;

    const isPrivateChat = ctx.chat.type === "private";
    logger.info(`[DIAGNOSTIC] Final_message:text handler: isPrivateChat=${isPrivateChat}`);

    // In DMs: all non-slash text is a prompt
    // In groups: only @botname or @ai prefixed text is a prompt
    let promptText: string;
    if (isPrivateChat) {
      const trimmed = text.trim();
      const botUsername = ctx.me?.username?.toLowerCase();

      // Strip @botname prefix if present (same as groups)
      if (botUsername && trimmed.toLowerCase().startsWith(`@${botUsername}`)) {
        promptText = trimmed.replace(new RegExp(`^@${botUsername}\\s*`, "i"), "");
      } else {
        promptText = trimmed;
      }

      // Check for inline command prefixes WITHOUT colon (e.g. "eli5 why..." in DMs)
      const inlineNoColon = detectInlineCommandWithoutColon(promptText);
      if (inlineNoColon) {
        const { command, actualQuery } = inlineNoColon;
        if (actualQuery.length >= command.minQueryLength) {
          const ackMsg = await ctx.reply(t("inline.thinking"));
          await addTaskJob({
            jobType: "llm_direct",
            command: command.slashCommand,
            query: actualQuery,
            chatId: ctx.chat!.id,
            ackMessageId: ackMsg.message_id,
            userId: ctx.from!.id,
            taskId: randomUUID(),
            promptText: actualQuery,
            sessionId: null,
            directory: "",
            agent: "",
            modelProvider: "",
            modelId: "",
            variant: null,
            parts: [],
          });
          return;
        }
      }
    } else {
      const trimmed = text.trim();
      const botUsername = ctx.me?.username?.toLowerCase();

      // Check for @botname mention (Telegram inserts actual bot username)
      if (botUsername && trimmed.toLowerCase().startsWith(`@${botUsername}`)) {
        promptText = trimmed.replace(new RegExp(`^@${botUsername}\\s*`, "i"), "");
      } else if (trimmed.toLowerCase().startsWith("@ai")) {
        // Backward compat: also accept @ai trigger
        promptText = trimmed.replace(/^@ai\s*/i, "");
      } else {
        logger.info(
          `[DIAGNOSTIC] Final_message:text handler: group chat, no @botname/@ai prefix, returning`,
        );
        return;
      }
    }

    logger.info(
      `[DIAGNOSTIC] Final_message:text handler: promptText="${promptText.substring(0, 80)}..."`,
    );

    if (questionManager.isActive(chatIdInstance!)) {
      logger.info(
        `[DIAGNOSTIC] Final_message:text handler: questionManager is active, routing to handleQuestionTextAnswer`,
      );
      await handleQuestionTextAnswer(ctx);
      return;
    }

    const handledTask = await handleTaskTextInput(ctx);
    if (handledTask) {
      logger.info(`[DIAGNOSTIC] Final_message:text handler: handled by handleTaskTextInput`);
      return;
    }

    const handledRename = await handleRenameTextAnswer(ctx);
    if (handledRename) {
      logger.info(`[DIAGNOSTIC] Final_message:text handler: handled by handleRenameTextAnswer`);
      return;
    }

    const promptDeps = { bot, ensureEventSubscription };
    const handledCommandArgs = await handleCommandTextArguments(ctx, promptDeps);
    if (handledCommandArgs) {
      logger.info(`[DIAGNOSTIC] Final_message:text handler: handled by handleCommandTextArguments`);
      return;
    }

    // Detect inline command prefixes (e.g. "summarise:", "eli5:", "deep-research:")
    // and enqueue as llm_direct jobs for non-blocking processing.
    const inlineMatch = detectInlineCommand(promptText);
    logger.info(
      `[DIAGNOSTIC] Final_message:text handler: detectInlineCommand result=${inlineMatch ? `matched prefix="${inlineMatch.command.prefix}"` : "NO MATCH"}`,
    );
    if (inlineMatch) {
      const { command, actualQuery } = inlineMatch;
      logger.info(
        `[DIAGNOSTIC] Final_message:text handler: inline command matched, actualQuery length=${actualQuery.length}, minRequired=${command.minQueryLength}`,
      );
      if (actualQuery.length >= command.minQueryLength) {
        logger.info(`[DIAGNOSTIC] Final_message:text handler: enqueuing llm_direct job`);
        const ackMsg = await ctx.reply(t("inline.thinking"));
        await addTaskJob({
          jobType: "llm_direct",
          command: command.slashCommand,
          query: actualQuery,
          chatId: ctx.chat!.id,
          ackMessageId: ackMsg.message_id,
          userId: ctx.from!.id,
          taskId: randomUUID(),
          promptText: actualQuery,
          sessionId: null,
          directory: "",
          agent: "",
          modelProvider: "",
          modelId: "",
          variant: null,
          parts: [],
        });
        return;
      }

      // Query too short — send user-friendly error
      logger.info(`[DIAGNOSTIC] Final_message:text handler: query too short, sending error`);
      await ctx.reply(
        t("inline.cmd.error.query_too_short", { min: String(command.minQueryLength) }),
      );
      return;
    }

    logger.info(
      `[DIAGNOSTIC] Final_message:text handler: no inline command, calling processUserPrompt with regular prompt`,
    );
    await processUserPrompt(ctx, promptText, promptDeps);

    logger.debug("[Bot] message:text handler completed (prompt sent in background)");
  });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    clearAllInteractionState(chatIdInstance!, "bot_unhandled_error");
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? Object.keys(err.ctx.update) : "unknown",
      );
    }
  });

  return bot;
}
