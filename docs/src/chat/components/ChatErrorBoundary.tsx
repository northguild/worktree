import { Component, type ErrorInfo, type ReactNode } from "react";

interface ChatErrorBoundaryProps {
  children: ReactNode;
}

interface ChatErrorBoundaryState {
  error: Error | null;
}

/** What a browser says when a lazily loaded chunk is gone: the site was redeployed while the page was open. */
const STALE_CHUNK =
  /dynamically imported module|Importing a module script failed|Failed to fetch/i;

const BUTTON =
  "rounded border border-current px-2 py-1 font-medium hover:bg-chat-fill-strong focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Keeps a render error inside the chat from unmounting it and leaving a
 * drawer-less page with nothing said (plan #257 D14, D16; adapted from gmt's
 * `ChatErrorBoundary`). A class because `getDerivedStateFromError` has no hook
 * equivalent. A stale chunk is not cured by rendering again, so it is offered a
 * reload; anything else can be reset. The notice is `role="alert"` (D18).
 */
export class ChatErrorBoundary extends Component<
  ChatErrorBoundaryProps,
  ChatErrorBoundaryState
> {
  state: ChatErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ChatErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The boundary makes the failure survivable, not invisible.
    console.error("[docs chat] crashed", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = STALE_CHUNK.test(error.message);
    return (
      <div
        role="alert"
        className="fixed bottom-24 right-6 z-[9999] flex max-w-xs flex-col gap-2 rounded-lg border border-chat-border bg-chat-bg px-4 py-3 text-sm text-chat-fg shadow-lg"
      >
        <p>
          {stale
            ? "The chat couldn't finish loading. This usually means the site was updated while this page was open."
            : "The chat hit an error."}
        </p>
        <button
          type="button"
          className={`self-start ${BUTTON}`}
          onClick={stale ? () => window.location.reload() : this.reset}
        >
          {stale ? "Reload the page" : "Try again"}
        </button>
      </div>
    );
  }
}
