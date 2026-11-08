import type { UIMessage as LibraryUIMessage } from "@tanstack/ai/client";

/**
 * The app's message type. This chat sends and renders text only (plan #257
 * D13), but `useChat` hands back the library's full `UIMessage`, so the alias
 * is the one place a later narrowing would go.
 */
export type UIMessage = LibraryUIMessage;

/** What the warning under the transcript shows (plan #257 §4.4). */
export interface ChatWarningState {
  message: string;
  retryable: boolean;
}
