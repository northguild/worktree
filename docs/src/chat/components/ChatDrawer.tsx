import { Button } from "@base-ui/react";
import { Drawer } from "@base-ui/react/drawer";
import { Menu } from "@base-ui/react/menu";
import { ChevronDownIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useMemo, useRef } from "react";
import { cn } from "../../utils";
import { FREE_MODELS } from "../constants";
import { useEnterAnimation } from "../hooks/useEnterAnimation";
import { useGlobalKeyDown } from "../hooks/useGlobalKeyDown";
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
    clearMessages,
    clearAllMessages,
  } = useChatContext();

  const popupRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const modelOptions = useMemo(() => FREE_MODELS, []);

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

  function handleModelChange(value: string | null): void {
    if (value) {
      // Each model has its own storage key — just switch; don't clear.
      // clearMessages() is only for the explicit Clear button.
      setModel(value);
    }
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
                    models={modelOptions}
                    onChange={handleModelChange}
                    selectedModel={model}
                  />
                </div>
                {/* Split clear button */}
                <div className="flex items-stretch border rounded overflow-hidden border-chat-control-border shrink-0">
                  <Button
                    onClick={clearMessages}
                    className="px-2 py-1 text-sm bg-chat-fill hover:bg-chat-fill-strong transition-colors"
                    aria-label="Clear current chat"
                  >
                    Clear
                  </Button>
                  <div className="w-px bg-chat-border self-stretch" />
                  <Menu.Root>
                    <Menu.Trigger
                      className="px-1 bg-chat-fill hover:bg-chat-fill-strong transition-colors flex items-center"
                      aria-label="More clear options"
                    >
                      <ChevronDownIcon className="w-3 h-3" />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        side="bottom"
                        align="end"
                        sideOffset={4}
                        positionMethod="fixed"
                        className="z-[10001]"
                      >
                        <Menu.Popup className="bg-chat-bg border border-chat-border rounded shadow-lg min-w-[160px] py-1">
                          <Menu.Item
                            onClick={clearMessages}
                            className="px-3 py-1.5 text-sm cursor-pointer hover:bg-chat-fill data-[highlighted]:bg-chat-fill"
                          >
                            Clear chat
                          </Menu.Item>
                          <Menu.Separator className="my-1 border-t border-chat-border" />
                          <Menu.Item
                            onClick={clearAllMessages}
                            className="px-3 py-1.5 text-sm cursor-pointer text-chat-danger hover:bg-chat-fill data-[highlighted]:bg-chat-fill"
                          >
                            Clear all chats
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                </div>
              </div>
            </div>

            <ChatPanel />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
