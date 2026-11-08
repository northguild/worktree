/**
 * The full-bleed `/dox` surface (plan #309 D6; ported from gmt's `DoxPage`). It is deliberately not a nav bar: the
 * site header shows on this route as on every page and gives the way back, so the strip holds chat status and the one
 * control that is the conversation's own, "New chat". The body holds the chat (`DoxChat`): the empty hub, or the
 * transcript, and the pinned composer. The rail arrives in a later phase.
 */
import { useEffect, useRef, useState } from "react";
import "../../styles/dox-hive.css";
import { ChatErrorBoundary } from "./ChatErrorBoundary";
import { DoxChat, type DoxChatHandle } from "./DoxChat";

/**
 * Which Worker this page is talking to. Read after mount, never during render: deriving it from `window.location`
 * made the server render one value and the client another, which React reports as a hydration mismatch. `null` is the
 * pre-mount state and renders nothing, so the badge cannot flicker from the wrong label to the right one.
 */
type Environment = "local" | "live";

function useEnvironment(): Environment | null {
  const [environment, setEnvironment] = useState<Environment | null>(null);
  useEffect(() => {
    const { hostname } = window.location;
    setEnvironment(
      hostname === "localhost" || hostname === "127.0.0.1" ? "local" : "live",
    );
  }, []);
  return environment;
}

export function DoxPage() {
  const environment = useEnvironment();
  const chatRef = useRef<DoxChatHandle>(null);
  const [empty, setEmpty] = useState(true);

  // `not-content` is Starlight's opt-out from its markdown rules: the island sits inside `.sl-markdown-content`, whose
  // `code` rules (colour, fill, size, margin, padding) would otherwise win over the hive's own at equal specificity.
  return (
    <div className="gmt-hive-shell not-content">
      <div className="gmt-hive-strip">
        <div className="gmt-hive-strip-end">
          {/* Replaces the drawer's "Clear chat" (D12). Only a transcript can be left, so an empty page has no button. */}
          {!empty && (
            <button
              type="button"
              className="gmt-hive-new"
              onClick={() => chatRef.current?.reset()}
            >
              New chat
            </button>
          )}
          {/* Standing status rather than a control, so it keeps the corner. */}
          {environment && (
            <span
              className="gmt-hive-env"
              data-env={environment}
              title={
                environment === "local"
                  ? "Pointed at a Worker on this machine"
                  : "Pointed at the deployed Worker"
              }
            >
              ● {environment}
            </span>
          )}
        </div>
      </div>
      <div className="gmt-hive-body" data-empty={empty ? "" : undefined}>
        <ChatErrorBoundary>
          <DoxChat ref={chatRef} onEmptyChange={setEmpty} />
        </ChatErrorBoundary>
      </div>
    </div>
  );
}
