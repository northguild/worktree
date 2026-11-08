"use client";
import { useChatContext } from "./ChatContext";
import { ChatForm } from "./ChatForm";
import { ChatWarning } from "./ChatWarning";
import { Messages } from "./Messages";

export function ChatPanel() {
  const { messages, isStreaming, sendMessage, warning, retry } =
    useChatContext();

  async function handleSubmit(message: string) {
    if (!message.trim() || isStreaming) return;
    await sendMessage(message);
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="flex flex-col h-full max-h-[90vh] border border-chat-border rounded-lg bg-chat-bg text-chat-fg">
        <Messages messages={messages} isStreaming={isStreaming} />
        {warning && <ChatWarning state={warning} onRetry={retry} />}
        <ChatForm onSubmit={handleSubmit} disabled={isStreaming} />
      </div>
    </div>
  );
}
