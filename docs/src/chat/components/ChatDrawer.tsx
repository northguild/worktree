import { Button } from "@base-ui/react";
import { Drawer } from "@base-ui/react/drawer";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useRef } from "react";
import { cn } from "../../utils";
import { useEnterAnimation } from "../hooks/useEnterAnimation";
import { useGlobalKeyDown } from "../hooks/useGlobalKeyDown";
import { CHAT_MODELS, type ChatModelId } from "../lib/chat-constants";
import { CHAT_SHORTCUT } from "../shortcut";
import { useChatContext } from "./ChatContext";
import { ChatModelSelect } from "./ChatModelSelect";
import { ChatPanel } from "./ChatPanel";
import { ChatTrigger } from "./ChatTrigger";

const IS_LOCAL_WORKER = (
  import.meta.env.PUBLIC_GEMINI_WORKER_URL || "http://localhost:8787"
).includes("localhost");

export function ChatDrawer() {
  const {
    isDrawerOpen,
    setIsDrawerOpen,
    isDrawerClosing,
    setIsDrawerClosing,
    entered,
    setEntered,
    model,
    setModel,
    clear,
  } = useChatContext();

  const popupRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  const handleOpen = useCallback(() => {
    setIsDrawerClosing(false);
    setIsDrawerOpen(true);
    setEntered(false);
  }, [setIsDrawerOpen, setIsDrawerClosing, setEntered]);

  const handleClose = useCallback(() => {
    setIsDrawerClosing(true);
    setEntered(false);
    setTimeout(() => {
      setIsDrawerOpen(false);
      setIsDrawerClosing(false);
    }, 480);
  }, [setIsDrawerOpen, setIsDrawerClosing, setEntered]);

  function handleModelChange(value: ChatModelId): void {
    // The model is a setting, not a conversation: switching keeps the
    // transcript. Only the explicit "Clear chat" button empties it.
    setModel(value);
  }

  // keyboard: toggle the chat with CHAT_SHORTCUT (Alt+Shift+C)
  useGlobalKeyDown({
    ...CHAT_SHORTCUT,
    callback: () => {
      if (isDrawerOpen) {
        handleClose();
        return;
      }
      handleOpen();
    },
  });

  // Drive entrance animation via two-phase mount.
  useEnterAnimation(isDrawerOpen, setEntered);

  return (
    <Drawer.Root
      open={isDrawerOpen}
      onOpenChange={(v) => (v ? handleOpen() : handleClose())}
    >
      <ChatTrigger />

      <Drawer.Portal>
        <Drawer.Backdrop
          ref={backdropRef}
          className={`bg-black/30 fixed inset-0 z-[9998] transition-opacity duration-300 ${
            isDrawerOpen || isDrawerClosing
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        />
        <Drawer.Viewport className="z-50" data-base-ui-swipe-ignore>
          <Drawer.Popup
            ref={popupRef}
            className={cn(
              "fixed top-0 bottom-0 right-0",
              "will-change-transform",
              "z-[9999]",
              "w-[400px] max-w-full h-full",
              "transform-gpu",
              "[-webkit-backface-visibility:hidden]",
              "bg-chat-bg",
              "border-l border-chat-border",
              "flex flex-col shadow-2xl text-chat-fg",
              "transition-transform duration-500 ease-in-out",
              entered && !isDrawerClosing
                ? "translate-x-0"
                : "translate-x-full",
            )}
          >
            <div className="flex flex-col p-4 border-b border-chat-border gap-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Drawer.Title className="font-semibold text-lg">
                    Chat with the Worktree CLI docs
                  </Drawer.Title>
                  {IS_LOCAL_WORKER && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-chat-warn-wash text-chat-warn-ink cursor-default select-none">
                      dev
                    </span>
                  )}
                </div>
                <Drawer.Close
                  aria-label="Close chat"
                  className="p-1 rounded hover:bg-chat-fill-strong transition-colors"
                >
                  <XMarkIcon className="h-5 w-5" />
                </Drawer.Close>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <ChatModelSelect
                    label="Model"
                    models={CHAT_MODELS}
                    onChange={handleModelChange}
                    selectedModel={model}
                  />
                </div>
                {/* Stops a stream first (useChat's clear) and removes the stored transcript. */}
                <Button
                  onClick={clear}
                  className="px-2 py-1 text-sm border rounded border-chat-control-border bg-chat-fill hover:bg-chat-fill-strong transition-colors shrink-0"
                >
                  Clear chat
                </Button>
              </div>
            </div>

            <ChatPanel />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
