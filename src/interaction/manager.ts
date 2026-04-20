import type {
  InteractionClearReason,
  InteractionState,
  StartInteractionOptions,
  TransitionInteractionOptions,
} from "./types.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_ALLOWED_INTERACTION_COMMANDS = ["/help", "/status", "/abort", "/stop", "/steer"] as const;

function normalizeCommand(command: string): string | null {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutMention = withSlash.split("@")[0];

  if (withoutMention.length <= 1) {
    return null;
  }

  return withoutMention;
}

function normalizeAllowedCommands(commands?: string[]): string[] {
  if (commands === undefined) {
    return [...DEFAULT_ALLOWED_INTERACTION_COMMANDS];
  }

  const normalized = new Set<string>();

  for (const command of commands) {
    const value = normalizeCommand(command);
    if (value) {
      normalized.add(value);
    }
  }

  return Array.from(normalized);
}

function cloneState(state: InteractionState): InteractionState {
  return {
    ...state,
    allowedCommands: [...state.allowedCommands],
    metadata: { ...state.metadata },
  };
}

class InteractionManager {
  private states: Map<number, InteractionState> = new Map();

  private getState(chatId: number): InteractionState | null {
    return this.states.get(chatId) ?? null;
  }

  start(chatId: number, options: StartInteractionOptions): InteractionState {
    const now = Date.now();
    let expiresAt: number | null = null;

    if (this.getState(chatId)) {
      this.clear(chatId, "state_replaced");
    }

    if (typeof options.expiresInMs === "number") {
      expiresAt = now + options.expiresInMs;
    }

    const nextState: InteractionState = {
      kind: options.kind,
      expectedInput: options.expectedInput,
      allowedCommands: normalizeAllowedCommands(options.allowedCommands),
      metadata: options.metadata ? { ...options.metadata } : {},
      createdAt: now,
      expiresAt,
    };

    this.states.set(chatId, nextState);

    logger.info(
      `[InteractionManager] Started interaction: kind=${nextState.kind}, expectedInput=${nextState.expectedInput}, allowedCommands=${nextState.allowedCommands.join(",") || "none"}`,
    );

    return cloneState(nextState);
  }

  get(chatId: number): InteractionState | null {
    const state = this.getState(chatId);
    if (!state) {
      return null;
    }

    return cloneState(state);
  }

  getSnapshot(chatId: number): InteractionState | null {
    return this.get(chatId);
  }

  isActive(chatId: number): boolean {
    return this.getState(chatId) !== null;
  }

  isExpired(chatId: number, referenceTimeMs: number = Date.now()): boolean {
    const state = this.getState(chatId);
    if (!state || state.expiresAt === null) {
      return false;
    }

    return referenceTimeMs >= state.expiresAt;
  }

  transition(chatId: number, options: TransitionInteractionOptions): InteractionState | null {
    const state = this.getState(chatId);
    if (!state) {
      return null;
    }

    const now = Date.now();

    const newState: InteractionState = {
      ...state,
      kind: options.kind ?? state.kind,
      expectedInput: options.expectedInput ?? state.expectedInput,
      allowedCommands:
        options.allowedCommands !== undefined
          ? normalizeAllowedCommands(options.allowedCommands)
          : [...state.allowedCommands],
      metadata: options.metadata ? { ...options.metadata } : { ...state.metadata },
      expiresAt:
        options.expiresInMs === undefined
          ? state.expiresAt
          : options.expiresInMs === null
            ? null
            : now + options.expiresInMs,
    };

    this.states.set(chatId, newState);

    logger.debug(
      `[InteractionManager] Transitioned interaction: kind=${newState.kind}, expectedInput=${newState.expectedInput}, allowedCommands=${newState.allowedCommands.join(",") || "none"}`,
    );

    return cloneState(newState);
  }

  clear(chatId: number, reason: InteractionClearReason = "manual"): void {
    const state = this.getState(chatId);
    if (!state) {
      return;
    }

    logger.info(
      `[InteractionManager] Cleared interaction: reason=${reason}, kind=${state.kind}, expectedInput=${state.expectedInput}`,
    );

    this.states.delete(chatId);
  }
}

export const interactionManager = new InteractionManager();
