/**
 * The full-bleed `/dox` surface (plan #309 D6; ported from gmt's `DoxPage`). It is deliberately not a nav bar: the
 * site header shows on this route as on every page and gives the way back, so the strip holds chat status (the reader's clock, the environment) and the one
 * control that is the conversation's own, "New chat". The body holds the chat (`DoxChat`): the empty hub, or the
 * transcript, and the pinned composer. Beside it (under it, on a phone) is the examples rail (D7): the starter questions,
 * which send through the composer, a resizer to widen it, and on a phone the bar above the composer that folds the sheet.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import "../../styles/dox-hive.css";
import type { ChatStarter } from "../lib/chat-starters";
import { ChatErrorBoundary } from "./ChatErrorBoundary";
import { DoxChat, type DoxChatHandle } from "./DoxChat";
import { ExamplesBar } from "./ExamplesBar";
import { ExamplesRail } from "./ExamplesRail";
import { HeaderClock } from "./HeaderClock";
import { RailResizer } from "./RailResizer";
import { useBrains } from "./use-brains";
import { useEscLayer } from "./use-esc-layer";

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
  // What Dox has left today: read once the page has mounted and kept current by the Worker's counts after each question.
  // Unreachable, it is `null`, and the control bar shows no badge.
  const { info: brains, refresh, apply } = useBrains();
  const chatRef = useRef<DoxChatHandle>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  const railId = useId();
  const [empty, setEmpty] = useState(true);
  // Phone: the reader has opened the examples sheet from the bar. Whether the sheet shows at all is the stylesheet's call.
  const [examplesOpen, setExamplesOpen] = useState(false);

  // A card sends its question through the composer's own guarded send. A refusal leaves focus on the card; a send moves it
  // to the field, and the sheet folds so the phone shows the answer.
  const pickExample = useCallback((starter: ChatStarter) => {
    if (chatRef.current?.send(starter.text)) setExamplesOpen(false);
  }, []);

  // Escape folds the phone's sheet back to its bar. Wider than a phone the bar is hidden and the state is not a layer.
  useEscLayer({
    open: () => examplesOpen && barRef.current?.checkVisibility?.() !== false,
    close: () => setExamplesOpen(false),
    opener: () => barRef.current,
  });

  // `not-content` is Starlight's opt-out from its markdown rules: the island sits inside `.sl-markdown-content`, whose
  // `code` rules (colour, fill, size, margin, padding) would otherwise win over the hive's own at equal specificity.
  return (
    <div className="gmt-hive-shell not-content">
      <div className="gmt-hive-strip">
        <div className="gmt-hive-strip-end">
          {/* The reader's local time, in the app's date format. Renders after mount. */}
          <HeaderClock />
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
      <div
        ref={bodyRef}
        className="gmt-hive-body"
        data-empty={empty ? "" : undefined}
      >
        <ChatErrorBoundary>
          <DoxChat
            ref={chatRef}
            onEmptyChange={setEmpty}
            brains={brains}
            onUsage={apply}
            onSpent={refresh}
            aboveComposer={
              <ExamplesBar
                ref={barRef}
                expanded={examplesOpen}
                railId={railId}
                onToggle={() => setExamplesOpen((open) => !open)}
              />
            }
          />
        </ChatErrorBoundary>
        <RailResizer railId={railId} container={bodyRef} />
        <ExamplesRail
          railId={railId}
          collapsed={!examplesOpen}
          onPick={pickExample}
        />
      </div>
    </div>
  );
}
