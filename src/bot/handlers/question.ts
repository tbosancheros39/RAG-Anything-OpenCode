import { Context, InlineKeyboard } from "grammy";
import { questionManager } from "../../question/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { getCurrentSession } from "../../session/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { interactionManager } from "../../interaction/manager.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { t } from "../../i18n/index.js";

const MAX_BUTTON_LENGTH = 60;

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function clearQuestionInteraction(chatId: number, reason: string): void {
  const state = interactionManager.getSnapshot(chatId);
  if (state?.kind === "question") {
    interactionManager.clear(chatId, reason);
  }
}

function syncQuestionInteractionState(
  chatId: number,
  expectedInput: "callback" | "mixed",
  questionIndex: number,
  messageId: number | null,
): void {
  const metadata: Record<string, unknown> = {
    questionIndex,
    inputMode: expectedInput === "mixed" ? "custom" : "options",
  };

  const requestID = questionManager.getRequestID(chatId);
  if (requestID) {
    metadata.requestID = requestID;
  }

  if (messageId !== null) {
    metadata.messageId = messageId;
  }

  const state = interactionManager.getSnapshot(chatId);
  if (state?.kind === "question") {
    interactionManager.transition(chatId, {
      expectedInput,
      metadata,
    });
    return;
  }

  interactionManager.start(chatId, {
    kind: "question",
    expectedInput,
    metadata,
    expiresInMs: 5 * 60 * 1000, // 5 minutes
  });
}

export async function handleQuestionCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  if (!data.startsWith("question:")) {
    return false;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  logger.debug(`[QuestionHandler] Received callback: ${data}`);

  if (!questionManager.isActive(chatId)) {
    clearQuestionInteraction(chatId, "question_inactive_callback");
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  const callbackMessageId = getCallbackMessageId(ctx);
  if (!questionManager.isActiveMessage(chatId, callbackMessageId)) {
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  const parts = data.split(":");
  const action = parts[1];
  const questionIndex = parseInt(parts[2], 10);

  if (Number.isNaN(questionIndex) || questionIndex !== questionManager.getCurrentIndex(chatId)) {
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    switch (action) {
      case "select":
        {
          const optionIndex = parseInt(parts[3], 10);
          if (Number.isNaN(optionIndex)) {
            await ctx.answerCallbackQuery({
              text: t("question.processing_error_callback"),
              show_alert: true,
            });
            break;
          }

          await handleSelectOption(ctx, chatId, questionIndex, optionIndex);
        }
        break;
      case "submit":
        await handleSubmitAnswer(ctx, chatId, questionIndex);
        break;
      case "custom":
        await handleCustomAnswer(ctx, chatId, questionIndex);
        break;
      case "cancel":
        await handleCancelPoll(ctx, chatId);
        break;
      default:
        await ctx.answerCallbackQuery({
          text: t("question.processing_error_callback"),
          show_alert: true,
        });
        break;
    }
  } catch (err) {
    logger.error("[QuestionHandler] Error handling callback:", err);
    await ctx.answerCallbackQuery({
      text: t("question.processing_error_callback"),
      show_alert: true,
    });
  }

  return true;
}

async function handleSelectOption(
  ctx: Context,
  chatId: number,
  questionIndex: number,
  optionIndex: number,
): Promise<void> {
  logger.debug(
    `[QuestionHandler] handleSelectOption: qIndex=${questionIndex}, oIndex=${optionIndex}`,
  );

  const question = questionManager.getCurrentQuestion(chatId);
  if (!question) {
    logger.debug("[QuestionHandler] No current question");
    return;
  }

  if (questionManager.isWaitingForCustomInput(chatId, questionIndex)) {
    questionManager.clearCustomInput(chatId);
    syncQuestionInteractionState(chatId, "callback", questionIndex, questionManager.getActiveMessageId(chatId));
  }

  questionManager.selectOption(chatId, questionIndex, optionIndex);

  if (question.multiple) {
    logger.debug("[QuestionHandler] Multiple choice mode, updating message");
    await updateQuestionMessage(ctx, chatId);
    await ctx.answerCallbackQuery();
  } else {
    logger.debug("[QuestionHandler] Single choice mode, moving to next question");
    await ctx.answerCallbackQuery();

    const answer = questionManager.getSelectedAnswer(chatId, questionIndex);
    logger.debug(`[QuestionHandler] Selected answer for question ${questionIndex}: ${answer}`);

    await ctx.deleteMessage().catch(() => {});

    await showNextQuestion(ctx, chatId);
  }
}

async function handleSubmitAnswer(ctx: Context, chatId: number, questionIndex: number): Promise<void> {
  if (questionManager.isWaitingForCustomInput(chatId, questionIndex)) {
    questionManager.clearCustomInput(chatId);
    syncQuestionInteractionState(chatId, "callback", questionIndex, questionManager.getActiveMessageId(chatId));
  }

  const answer = questionManager.getSelectedAnswer(chatId, questionIndex);

  if (!answer) {
    await ctx.answerCallbackQuery({
      text: t("question.select_one_required_callback"),
      show_alert: true,
    });
    return;
  }

  logger.debug(`[QuestionHandler] Submit answer for question ${questionIndex}: ${answer}`);

  await ctx.answerCallbackQuery();

  await ctx.deleteMessage().catch(() => {});

  await showNextQuestion(ctx, chatId);
}

async function handleCustomAnswer(ctx: Context, chatId: number, questionIndex: number): Promise<void> {
  questionManager.startCustomInput(chatId, questionIndex);
  syncQuestionInteractionState(chatId, "mixed", questionIndex, questionManager.getActiveMessageId(chatId));

  await ctx.answerCallbackQuery({
    text: t("question.enter_custom_callback"),
    show_alert: true,
  });
}

async function handleCancelPoll(ctx: Context, chatId: number): Promise<void> {
  questionManager.cancel(chatId);
  clearQuestionInteraction(chatId, "question_cancelled");

  await ctx.editMessageText(t("question.cancelled")).catch(() => {});
  await ctx.answerCallbackQuery();

  questionManager.clear(chatId);
}

async function updateQuestionMessage(ctx: Context, chatId: number): Promise<void> {
  const question = questionManager.getCurrentQuestion(chatId);
  if (!question) {
    logger.debug("[QuestionHandler] updateQuestionMessage: no current question");
    return;
  }

  const text = formatQuestionText(question, chatId);
  const keyboard = buildQuestionKeyboard(
    question,
    questionManager.getSelectedOptions(chatId, questionManager.getCurrentIndex(chatId)),
    chatId,
  );

  logger.debug("[QuestionHandler] Updating question message");

  try {
    await ctx.editMessageText(text, {
      reply_markup: keyboard,
    });
  } catch (err) {
    logger.error("[QuestionHandler] Failed to update message:", err);
  }
}

export async function showCurrentQuestion(bot: Context["api"], chatId: number): Promise<void> {
  const question = questionManager.getCurrentQuestion(chatId);

  if (!question) {
    await showPollSummary(bot, chatId);
    return;
  }

  logger.debug(`[QuestionHandler] Showing question: ${question.header} - ${question.question}`);

  const text = formatQuestionText(question, chatId);
  const keyboard = buildQuestionKeyboard(
    question,
    questionManager.getSelectedOptions(chatId, questionManager.getCurrentIndex(chatId)),
    chatId,
  );

  logger.debug(`[QuestionHandler] Sending message with keyboard, chatId=${chatId}`);

  try {
    const message = await bot.sendMessage(chatId, text, {
      reply_markup: keyboard,
    });

    logger.debug(`[QuestionHandler] Message sent, messageId=${message.message_id}`);

    questionManager.addMessageId(chatId, message.message_id);
    questionManager.setActiveMessageId(chatId, message.message_id);
    syncQuestionInteractionState(
      chatId,
      "callback",
      questionManager.getCurrentIndex(chatId),
      questionManager.getActiveMessageId(chatId),
    );

    summaryAggregator.stopTypingIndicator();
  } catch (err) {
    questionManager.clear(chatId);
    clearQuestionInteraction(chatId, "question_message_send_failed");

    logger.error("[QuestionHandler] Failed to send question message:", err);
    throw err;
  }
}

export async function handleQuestionTextAnswer(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const currentIndex = questionManager.getCurrentIndex(chatId);

  if (!questionManager.isWaitingForCustomInput(chatId, currentIndex)) {
    await ctx.reply(t("question.use_custom_button_first"));
    return;
  }

  if (questionManager.hasCustomAnswer(chatId, currentIndex)) {
    await ctx.reply(t("question.answer_already_received"));
    return;
  }

  logger.debug(`[QuestionHandler] Custom text answer for question ${currentIndex}: ${text}`);

  questionManager.setCustomAnswer(chatId, currentIndex, text);
  questionManager.clearCustomInput(chatId);

  const activeMessageId = questionManager.getActiveMessageId(chatId);
  if (activeMessageId !== null && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, activeMessageId).catch(() => {});
  }

  await showNextQuestion(ctx, chatId);
}

async function showNextQuestion(ctx: Context, chatId: number): Promise<void> {
  questionManager.nextQuestion(chatId);

  if (!ctx.chat) {
    return;
  }

  if (questionManager.hasNextQuestion(chatId)) {
    await showCurrentQuestion(ctx.api, ctx.chat.id);
  } else {
    await showPollSummary(ctx.api, ctx.chat.id);
  }
}

async function showPollSummary(bot: Context["api"], chatId: number): Promise<void> {
  const answers = questionManager.getAllAnswers(chatId);
  const totalQuestions = questionManager.getTotalQuestions(chatId);

  logger.info(
    `[QuestionHandler] Poll completed: ${answers.length}/${totalQuestions} questions answered`,
  );

  await sendAllAnswersToAgent(bot, chatId);

  if (answers.length === 0) {
    await bot.sendMessage(chatId, t("question.completed_no_answers"));
  } else {
    const summary = formatAnswersSummary(answers);
    await bot.sendMessage(chatId, summary);
  }

  clearQuestionInteraction(chatId, "question_completed");
  questionManager.clear(chatId);
  logger.debug("[QuestionHandler] Poll completed and cleared");
}

async function sendAllAnswersToAgent(bot: Context["api"], chatId: number): Promise<void> {
  const currentProject = getCurrentProject(chatId);
  const currentSession = getCurrentSession(chatId);
  const requestID = questionManager.getRequestID(chatId);
  const totalQuestions = questionManager.getTotalQuestions(chatId);
  const directory = currentSession?.directory ?? currentProject?.worktree;

  if (!directory) {
    logger.error("[QuestionHandler] No project for sending answers");
    await bot.sendMessage(chatId, t("question.no_active_project"));
    return;
  }

  if (!requestID) {
    logger.error("[QuestionHandler] No requestID for sending answers");
    await bot.sendMessage(chatId, t("question.no_active_request"));
    return;
  }

  const allAnswers: string[][] = [];

  for (let i = 0; i < totalQuestions; i++) {
    const customAnswer = questionManager.getCustomAnswer(chatId, i);
    const selectedAnswer = questionManager.getSelectedAnswer(chatId, i);

    const answer = customAnswer || selectedAnswer || "";

    if (answer) {
      const answerParts = answer.split("\n").filter((part) => part.trim());
      allAnswers.push(answerParts);
    } else {
      allAnswers.push([]);
    }
  }

  logger.info(
    `[QuestionHandler] Sending all ${totalQuestions} answers to agent via question.reply: requestID=${requestID}`,
  );
  logger.debug(`[QuestionHandler] Answers payload:`, JSON.stringify(allAnswers, null, 2));

  safeBackgroundTask({
    taskName: "question.reply",
    task: () =>
      opencodeClient.question.reply({
        requestID,
        directory,
        answers: allAnswers,
      }),
    onSuccess: ({ error }) => {
      if (error) {
        logger.error("[QuestionHandler] Failed to send answers via question.reply:", error);
        void bot.sendMessage(chatId, t("question.send_answers_error")).catch(() => {});
        return;
      }

      logger.info("[QuestionHandler] All answers sent to agent successfully via question.reply");
    },
  });
}

function formatQuestionText(question: {
  header: string;
  question: string;
  multiple?: boolean;
}, chatId: number): string {
  const currentIndex = questionManager.getCurrentIndex(chatId);
  const totalQuestions = questionManager.getTotalQuestions(chatId);
  const progressText = totalQuestions > 0 ? `${currentIndex + 1}/${totalQuestions}` : "";

  const headerTitle = [progressText, question.header].filter(Boolean).join(" ");
  const header = headerTitle ? `${headerTitle}\n\n` : "";
  const multiple = question.multiple ? t("question.multi_hint") : "";
  return `${header}${question.question}${multiple}`;
}

function buildQuestionKeyboard(
  question: { options: Array<{ label: string; description: string }>; multiple?: boolean },
  selectedOptions: Set<number>,
  chatId: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const questionIndex = questionManager.getCurrentIndex(chatId);

  logger.debug(`[QuestionHandler] Building keyboard for question ${questionIndex}`);

  question.options.forEach((option, index) => {
    const isSelected = selectedOptions.has(index);
    const icon = isSelected ? "✅ " : "";
    const buttonText = formatButtonText(option.label, option.description, icon);
    const callbackData = `question:select:${questionIndex}:${index}`;

    logger.debug(`[QuestionHandler] Button ${index}: "${buttonText}" -> "${callbackData}"`);

    keyboard.text(buttonText, callbackData).row();
  });

  if (question.multiple) {
    keyboard.text(t("question.button.submit"), `question:submit:${questionIndex}`).row();
    logger.debug(`[QuestionHandler] Added submit button`);
  }

  keyboard.text(t("question.button.custom"), `question:custom:${questionIndex}`).row();
  logger.debug(`[QuestionHandler] Added custom answer button`);

  keyboard.text(t("question.button.cancel"), `question:cancel:${questionIndex}`);
  logger.debug(`[QuestionHandler] Added cancel button`);

  logger.debug(`[QuestionHandler] Final keyboard: ${JSON.stringify(keyboard.inline_keyboard)}`);

  return keyboard;
}

function formatButtonText(label: string, description: string, icon: string): string {
  let text = `${icon}${label}`;

  if (description && icon === "") {
    text += ` - ${description}`;
  }

  if (text.length > MAX_BUTTON_LENGTH) {
    text = text.substring(0, MAX_BUTTON_LENGTH - 3) + "...";
  }

  return text;
}

function formatAnswersSummary(answers: Array<{ question: string; answer: string }>): string {
  let summary = t("question.summary.title");

  answers.forEach((item, index) => {
    summary += t("question.summary.question", {
      index: index + 1,
      question: item.question,
    });
    summary += t("question.summary.answer", { answer: item.answer });
  });

  return summary;
}
