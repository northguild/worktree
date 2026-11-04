import { Drawer } from "@base-ui/react/drawer";
import { ChatBubbleBottomCenterIcon } from "@heroicons/react/24/outline";
import { CHAT_SHORTCUT_ARIA } from "../shortcut";
import { useChatContext } from "./ChatContext";

/** Looks like the static launcher (`.chat-launcher`, globals.css) it replaces once the chat has loaded. */
export function ChatTrigger() {
  const { isDrawerOpen } = useChatContext();

  return (
    <Drawer.Trigger
      aria-label={isDrawerOpen ? "Close chat" : "Open chat"}
      aria-keyshortcuts={CHAT_SHORTCUT_ARIA}
      className="chat-launcher"
    >
      <ChatBubbleBottomCenterIcon aria-hidden="true" />
    </Drawer.Trigger>
  );
}
