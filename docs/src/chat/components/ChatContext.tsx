import type { Dispatch, SetStateAction } from "react";
import { createContext, useContext, useState } from "react";
import { z } from "zod";
import { type DocsChat, useDocsChat } from "../hooks/useDocsChat";
import { useLocalStorage } from "../hooks/useLocalStorage";
import {
  CHAT_MODEL_IDS,
  type ChatModelId,
  DEFAULT_MODEL_ID,
} from "../lib/chat-constants";

/** Anything stored that is not one of the models on offer reads as the default (plan #257 D12). */
const storedModel = z.enum(CHAT_MODEL_IDS).catch(DEFAULT_MODEL_ID);

interface ChatContextValue extends DocsChat {
  // Drawer / UI state
  isDrawerOpen: boolean;
  setIsDrawerOpen: Dispatch<SetStateAction<boolean>>;
  isDrawerClosing: boolean;
  setIsDrawerClosing: Dispatch<SetStateAction<boolean>>;
  entered: boolean;
  setEntered: Dispatch<SetStateAction<boolean>>;
  // Model selection
  model: ChatModelId;
  setModel: (model: ChatModelId) => void;
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
  const { value: storedValue, setValue: setStoredModel } =
    useLocalStorage<unknown>("docs_chat_model", DEFAULT_MODEL_ID);
  const model = storedModel.parse(storedValue);

  const chat = useDocsChat(model);

  return (
    <ChatContext.Provider
      value={{
        ...chat,
        isDrawerOpen,
        setIsDrawerOpen,
        isDrawerClosing,
        setIsDrawerClosing,
        entered,
        setEntered,
        model,
        setModel: setStoredModel,
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
