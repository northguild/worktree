import { CHAT_STARTERS } from "../lib/chat-starters";

interface ChatStartersProps {
  /** Sends the question; the caller owns the guarded send and where focus goes next. */
  onPick: (text: string) => void;
}

/** The empty transcript's three questions, each a button named by its own text (plan #257 Phase 6). */
export function ChatStarters({ onPick }: ChatStartersProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-chat-muted">Try asking</p>
      <ul className="flex flex-col gap-2">
        {CHAT_STARTERS.map(({ text }) => (
          <li key={text}>
            <button
              type="button"
              onClick={() => onPick(text)}
              className="w-full rounded-lg border border-chat-control-border bg-chat-fill px-3 py-2 text-left text-sm text-chat-fg hover:bg-chat-fill-strong focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
