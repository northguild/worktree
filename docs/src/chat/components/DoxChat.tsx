/**
 * The transcript and the composer, host-agnostic (plan #309 Phase 2; ported from gmt's `DoxChat`). `DoxPage` supplies the
 * shell and the strip; this renders what is under them: the empty hub, or the turns, the warning, the pinned composer
 * and the accuracy note.
 *
 * The engine is unchanged (D3): `useDocsChat` over `useChat`. gmt's parts are this site's existing ones (D4): the
 * answer is `MarkdownContent`, the field `ChatInput`, the button `ChatSubmitButton`, the failure `ChatWarning`.
 */
import {
  ArrowDownIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  ViewTransition,
} from "react";
import { CORPUS_COUNTS } from "../docs-routes.generated";
import { type ScrollTarget, useBottomScroll } from "../hooks/useBottomScroll";
import { type RetrievalTraces, useDocsChat } from "../hooks/useDocsChat";
import { MAX_MESSAGE_LENGTH } from "../lib/chat-constants";
import { messageText } from "../lib/chat-history";
import type { RetrievalTraceData, UIMessage } from "../lib/chat-types";
import { AccuracyNote, ChatInfo } from "./ChatInfo";
import { ChatInput } from "./ChatInput";
import { ChatSubmitButton } from "./ChatSubmitButton";
import { ChatWarning } from "./ChatWarning";
import { HiveHub } from "./hive/HiveHub";
import { HiveNode } from "./hive/HiveNode";
import { MarkdownContent } from "./MarkdownContent";
import { RetrievalTrace } from "./RetrievalTrace";

/** What the field asks for. The package is `@northguild/worktree` where gmt's is `@northguild/gmt`. */
const PLACEHOLDER = "Ask about @northguild/worktree…";

/** What the waiting turn says until the Worker says something of its own: its progress lines replace it (plan #309 D9). */
const WAITING = "Searching docs…";

/** One turn of the transcript: a question, an answer, or the wait for one. */
interface Turn {
  /** Stable from the wait to the answer, so the crystal that spun while waiting is the one that lands (see `buildTurns`). */
  key: string;
  speaker: "user" | "assistant";
  text: string;
  /** Dox is working on this one: no text yet, and the newest turn. */
  pending: boolean;
  /** What the Worker retrieved for this answer, once it has said (it does so before the first text). */
  trace?: RetrievalTraceData;
  /** What the Worker last said it was doing, on the turn still waiting for text. */
  progress?: string | null;
}

/**
 * The turns to show for what `useChat` holds. Only questions and answers with text are turns. The one exception is the
 * answer being written: while a reply is on its way the turn is shown before its first text, from the library's empty
 * trailing assistant message or, before even that exists, from a stand-in. An empty answer anywhere else (stopped
 * before the first token, killed by an error) is not a turn: the reader sees the warning, never an empty card.
 *
 * An answer's key is its question's, so the stand-in and the message that replaces it are one turn to React and the
 * crystal's spin carries on into its landing instead of a new crystal appearing.
 */
function buildTurns(
  messages: ReadonlyArray<UIMessage>,
  isStreaming: boolean,
  traces: RetrievalTraces,
  progress: string | null,
): Turn[] {
  const turns: Turn[] = [];
  const used = new Set<string>();
  let questionId: string | undefined;
  let questionNumber = 0;

  messages.forEach((message, index) => {
    const text = messageText(message);
    if (message.role === "user") {
      questionId = message.id;
      questionNumber += 1;
      turns.push({ key: message.id, speaker: "user", text, pending: false });
      return;
    }
    if (message.role !== "assistant") return;
    const pending =
      isStreaming && index === messages.length - 1 && text.trim() === "";
    if (text.trim() === "" && !pending) return;
    const replyKey = questionId ? `reply:${questionId}` : message.id;
    const key = used.has(replyKey) ? message.id : replyKey;
    used.add(key);
    turns.push({
      key,
      speaker: "assistant",
      text,
      pending,
      trace: traces[questionNumber],
      progress: pending ? progress : null,
    });
  });

  const last = turns.at(-1);
  if (isStreaming && last?.speaker === "user") {
    turns.push({
      key: `reply:${last.key}`,
      speaker: "assistant",
      text: "",
      pending: true,
      trace: traces[questionNumber],
      progress,
    });
  }
  return turns;
}

/**
 * Gives the transcript's scroll box a name and a tab stop only while it overflows (plan #309 §4.1 row 18). A box that
 * scrolls must take focus so the arrow keys reach it (axe `scrollable-region-focusable`), and a focusable region needs a
 * name; a short conversation and the hub are not a tab stop. The attributes are set on the element itself and React
 * never owns them, so a render does not remove them.
 */
function useScrollRegion(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLDivElement | null>,
  turnCount: number,
) {
  // `turnCount` is not read: a turn arriving is a reason to measure again where no observer is available.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      if (scroller.scrollHeight > scroller.clientHeight + 1) {
        scroller.tabIndex = 0;
        scroller.setAttribute("role", "region");
        scroller.setAttribute("aria-label", "Conversation, scrollable");
      } else {
        scroller.removeAttribute("tabindex");
        scroller.removeAttribute("role");
        scroller.removeAttribute("aria-label");
      }
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    // The scroller keeps its size as turns arrive; its content is what grows.
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [scrollerRef, contentRef, turnCount]);
}

export interface DoxChatHandle {
  /** Empties the transcript, shows the hub and puts focus in the composer. */
  reset: () => void;
  /**
   * Sends `text` as the reader's question through the composer's own guarded send, for the host's example cards: false
   * while an answer is still coming, for an empty text, or when the text is refused (the reason is shown as a warning).
   * A draft in the field is left alone.
   */
  send: (text: string) => boolean;
}

interface DoxChatProps {
  /** Lets the host (the strip's "New chat") reset the conversation. */
  ref?: Ref<DoxChatHandle>;
  /** Fired with `true` while the conversation has nothing to show. Raw, not deferred, so the host's chrome follows the first send at once. */
  onEmptyChange?: (empty: boolean) => void;
  /** Rendered directly above the composer's panel: the phone's examples bar (the host owns it, and CSS shows it). */
  aboveComposer?: ReactNode;
}

export function DoxChat({
  ref,
  onEmptyChange,
  aboveComposer,
}: DoxChatProps = {}) {
  // No model named: Automatic, the Worker's own order (D9). The brain menu that picks one is phase 8's.
  const {
    messages,
    traces,
    isStreaming,
    progress,
    warning,
    submit,
    retry,
    stop,
    clear,
  } = useDocsChat();

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastSnapshotRef = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const focusStopWhenAnswering = useRef(false);

  const [value, setValue] = useState("");
  const empty = value.trim() === "";

  const turns = buildTurns(messages, isStreaming, traces, progress);
  const noTurns = turns.length === 0;
  // Deferred, so the swap from the hub to the transcript runs as a transition and its `<ViewTransition>`s animate:
  // `useChat` pushes the first message as a plain synchronous update, which never starts one.
  const showHub = useDeferredValue(noTurns);

  const lastTurn = turns.at(-1);
  const scrollTarget: ScrollTarget | undefined = lastTurn && {
    id: lastTurn.key,
    role: lastTurn.speaker,
    text: lastTurn.text,
    streaming: isStreaming,
  };
  const { isAtBottom, scrollToBottom } = useBottomScroll({
    containerRef: scrollerRef,
    endRef,
    lastSnapshotRef,
    last: scrollTarget,
  });
  useScrollRegion(scrollerRef, contentRef, turns.length);

  useEffect(() => {
    onEmptyChange?.(noTurns);
  }, [noTurns, onEmptyChange]);

  // The one send: the composer's Enter and button, and the host's example cards, all come through it.
  const sendText = useCallback(
    (text: string) => {
      if (isStreaming || text.trim() === "") return false;
      // A refused message is not sent and the reason is shown as a warning by `useDocsChat`.
      if (!submit(text)) return false;
      inputRef.current?.focus();
      return true;
    },
    [isStreaming, submit],
  );

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        clear();
        setValue("");
        // The button that asked for this goes with the transcript, and focus would fall to the page.
        inputRef.current?.focus();
      },
      send: sendText,
    }),
    [clear, sendText],
  );

  // "Try again" clears the warning, which unmounts the button the keyboard user is on, and focus would fall to the page.
  // It goes to the submit button instead, which is "Stop answer" for as long as the retry is answering. The button only
  // becomes that on the next render, so the move waits for it (ported from `ChatPanel`).
  useEffect(() => {
    if (isStreaming && focusStopWhenAnswering.current) {
      focusStopWhenAnswering.current = false;
      submitRef.current?.focus();
      return;
    }
    // The answer ended with focus on the button, which is now a Send with nothing to send: the field takes it.
    if (
      !isStreaming &&
      document.activeElement === submitRef.current &&
      submitRef.current?.getAttribute("aria-disabled") === "true"
    ) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

  async function handleRetry() {
    focusStopWhenAnswering.current = true;
    await retry();
    // The retry ended without ever showing Stop, or ended and left Send disabled for an empty box (a disabled Send is
    // not worth keeping focus on): the field can.
    focusStopWhenAnswering.current = false;
    const active = document.activeElement;
    if (
      active === document.body ||
      (active === submitRef.current &&
        submitRef.current?.getAttribute("aria-disabled") === "true")
    ) {
      inputRef.current?.focus();
    }
  }

  function send() {
    // A refused message stays in the box.
    if (sendText(value)) setValue("");
  }

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    send();
  }

  // What Enter means belongs to the form, not to the field (ported from `ChatForm`).
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // While an IME composition is active, Enter confirms a candidate rather than ending the message.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  // Back to the newest turn, and the button the reader pressed leaves with it: focus goes to the transcript they were reading.
  const jumpToLatest = useCallback(() => {
    scrollToBottom();
    scrollerRef.current?.focus({ preventScroll: true });
  }, [scrollToBottom]);

  return (
    <div className="gmt-hive-chat">
      <div className="gmt-hive-transcript">
        <div className="gmt-hive-scroller" ref={scrollerRef}>
          <div className="gmt-hive" ref={contentRef}>
            {showHub ? (
              <ViewTransition key="empty" exit="gmt-hive-out" default="none">
                <div className="gmt-hive-empty">
                  <HiveHub />
                  {/* What the Worker indexes, counted when the docs were built (plan #309 §4.1 row 6). */}
                  <p className="gmt-hive-status">
                    {`Dox // ${CORPUS_COUNTS.pages} pages · ${CORPUS_COUNTS.chunks} sections indexed`}
                  </p>
                  {/* Names the character: the code treatment ties "Dox" to the crystal above it and to the package
                      name, so both read as identifiers and not as prose. */}
                  <p className="gmt-hive-prompt">
                    Ask <code className="gmt-hive-name">Dox</code> about
                    worktrees, branches and issues in{" "}
                    <code>@northguild/worktree</code>.
                  </p>
                </div>
              </ViewTransition>
            ) : (
              <ViewTransition
                key="transcript"
                enter="gmt-hive-in"
                default="none"
              >
                <div className="gmt-hive-turns">
                  {turns.map((turn) => (
                    <TurnView key={turn.key} turn={turn} />
                  ))}
                </div>
              </ViewTransition>
            )}
            {warning && <ChatWarning state={warning} onRetry={handleRetry} />}
            <div ref={endRef} />
          </div>
        </div>
        {!isAtBottom && (
          <button
            type="button"
            className="gmt-hive-jump"
            aria-label="Jump to latest message"
            onClick={jumpToLatest}
          >
            <ArrowDownIcon aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="gmt-hive-composer">
        <div className="gmt-hive-composer-inner">
          {aboveComposer}
          <form className="gmt-hive-form" onSubmit={handleSubmit}>
            <ChatInput
              ref={inputRef}
              value={value}
              onChange={setValue}
              label="Message"
              placeholder={PLACEHOLDER}
              className="gmt-hive-field"
              maxLength={MAX_MESSAGE_LENGTH}
              onKeyDown={handleKeyDown}
            />
            <div className="gmt-hive-composer-footer">
              <div className="gmt-hive-controls">
                <ChatInfo />
              </div>
              <ChatSubmitButton
                ref={submitRef}
                answering={isStreaming}
                empty={empty}
                onStop={stop}
                className="gmt-hive-submit"
              />
            </div>
          </form>
          {/* Under every question on a wide screen; on a phone it moves into the info button's popup. */}
          <AccuracyNote className="gmt-hive-accuracy-note" />
        </div>
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const labelId = useId();
  const { speaker, text, pending, trace, progress } = turn;

  return (
    <article
      className="gmt-hive-turn"
      data-role={speaker}
      aria-labelledby={labelId}
    >
      <HiveNode speaker={speaker} pending={pending} labelId={labelId} />
      <div className="gmt-hive-card" data-pending={pending ? "" : undefined}>
        {/* Outside the live region below: the trace lands before the first text, and a reader should hear the answer
            announced, not the retrieval log. It is there to open, not to be read out. */}
        {trace && <RetrievalTrace data={trace} />}
        {speaker === "assistant" ? (
          // A polite live region from the wait on, so the first text is announced as it lands: a region announces
          // changes, not what it holds when inserted.
          <div className="gmt-hive-live" aria-live="polite" aria-atomic={false}>
            {pending ? (
              <p className="gmt-hive-pending">
                <MagnifyingGlassIcon aria-hidden="true" />
                {progress ?? WAITING}
              </p>
            ) : (
              <div className="gmt-hive-response">
                <MarkdownContent content={text} />
              </div>
            )}
          </div>
        ) : (
          // The reader's own text is rendered as text, never as markdown: someone who types * or # means those characters.
          <p className="gmt-hive-user-text">{text}</p>
        )}
        {pending && <span className="gmt-hive-scanline" aria-hidden="true" />}
      </div>
    </article>
  );
}
