import { createRoot } from "react-dom/client";
import { ChatProvider } from "./ChatContext";
import { ChatDrawer } from "./ChatDrawer";

interface ChatProps {
  /** Mount with the drawer already open: the launcher's first activation opens the chat it has just loaded. */
  defaultOpen?: boolean;
}

export function Chat({ defaultOpen = false }: ChatProps) {
  return (
    <ChatProvider defaultOpen={defaultOpen}>
      <ChatDrawer />
    </ChatProvider>
  );
}

/** The lazily imported entry: `launcher.ts` calls this once, after `import()`ing this module. */
export function mountChat({ open }: { open: boolean }) {
  const host = document.createElement("div");
  document.body.append(host);
  createRoot(host).render(<Chat defaultOpen={open} />);
}
