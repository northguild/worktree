import type { Dispatch, SetStateAction } from "react";
import { createContext, useCallback, useContext, useState } from "react";
import { ALLOWED_MODELS, DEFAULT_MODEL } from "../constants";
import {
  removeLocalStorageItem,
  useLocalStorage,
} from "../hooks/useLocalStorage";
import { useStreamChat } from "../hooks/useStreamChat";
import type { ChatMessage } from "../types";

interface ChatContextValue {
  // Drawer / UI state
  isDrawerOpen: boolean;
  setIsDrawerOpen: Dispatch<SetStateAction<boolean>>;
  isDrawerClosing: boolean;
  setIsDrawerClosing: Dispatch<SetStateAction<boolean>>;
  entered: boolean;
  setEntered: Dispatch<SetStateAction<boolean>>;
  // Model selection
  model: string;
  setModel: Dispatch<SetStateAction<string>>;
  // Chat state (from useStreamChat)
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (text: string) => Promise<void>;
  clearMessages: () => void;
  clearAllMessages: () => void;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({
  children,
  defaultOpen = false,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(defaultOpen);
  const [isDrawerClosing, setIsDrawerClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const { value: model, setValue: setModel } = useLocalStorage<string>(
    "docs_chat_model",
    DEFAULT_MODEL,
  );

  const { messages, isStreaming, sendMessage, clearMessages } =
    useStreamChat(model);

  const clearAllMessages = useCallback(() => {
    clearMessages();
    for (const m of ALLOWED_MODELS) {
      if (m !== model) {
        removeLocalStorageItem(`docs_chat_history_${m}`);
      }
    }
  }, [clearMessages, model]);

  return (
    <ChatContext.Provider
      value={{
        isDrawerOpen,
        setIsDrawerOpen,
        isDrawerClosing,
        setIsDrawerClosing,
        entered,
        setEntered,
        model,
        setModel,
        messages,
        isStreaming,
        sendMessage,
        clearMessages,
        clearAllMessages,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}
