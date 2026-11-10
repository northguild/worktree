import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, vi } from "vitest";
import answerStream from "../hooks/fixtures/chat-answer.sse?raw";
import { brainsInfo } from "./brains.fixture";
import { DoxPage } from "./DoxPage";
import type { BrainsInfo } from "./use-brains";

// Expected values: plan #309 Phase 1 "Done when" (the prompt line and an aria-hidden crystal SVG) and §4.1 rows 1, 3
// and 7 (the empty hub, the environment badge `● local` / `● live` with a title, and the prompt line "Ask Dox about
// ... in @northguild/worktree"). The wording of the prompt line is the plan's §9 Q9 ("worktree wording").

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  // A disposed chat client may still save on a timer; let it land in this test's storage.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  vi.unstubAllGlobals();
});

describe("DoxPage", () => {
  it("shows the prompt line naming Dox and the package", () => {
    render(<DoxPage />);
    const prompt = screen.getByText(/^Ask/, { selector: "p" });
    expect(prompt).toHaveTextContent(
      "Ask Dox about worktrees, branches and issues in @northguild/worktree.",
    );
  });

  it("draws the crystal as an aria-hidden SVG, so the page names it once and in words", () => {
    const { container } = render(<DoxPage />);
    // The crystal is the 100 x 87 mark; the composer's icons are other SVGs.
    const crystals = container.querySelectorAll('svg[viewBox="0 0 100 87"]');
    expect(crystals).toHaveLength(1);
    expect(crystals[0]).toHaveAttribute("aria-hidden", "true");
    expect(crystals[0]).toHaveAttribute("focusable", "false");
  });

  it("badges a page opened on this machine as local, with a title", async () => {
    // jsdom's own location is http://localhost:3000.
    render(<DoxPage />);
    const badge = await screen.findByText("● local");
    expect(badge).toHaveAttribute(
      "title",
      "Pointed at a Worker on this machine",
    );
  });

  it("badges a page on any other host as live, with a title", async () => {
    vi.stubGlobal("location", {
      ...window.location,
      hostname: "northguild.dev",
    });
    render(<DoxPage />);
    const badge = await screen.findByText("● live");
    expect(badge).toHaveAttribute("title", "Pointed at the deployed Worker");
  });

  it("badges 127.0.0.1 as local too", async () => {
    vi.stubGlobal("location", { ...window.location, hostname: "127.0.0.1" });
    render(<DoxPage />);
    expect(await screen.findByText("● local")).toBeInTheDocument();
  });

  it("opts out of Starlight's markdown rules, which would recolour the prompt's code chips", () => {
    const { container } = render(<DoxPage />);
    expect(container.firstElementChild).toHaveClass("not-content");
  });

  it("renders no badge until the page has mounted, so the server markup matches the first client render", () => {
    // `renderToString` runs no effects: it is the server's pass.
    const html = renderToString(<DoxPage />);
    expect(html).not.toContain("● ");
  });

  it("holds the hub and the composer in the body, marked empty, with no New chat to press", async () => {
    const { container } = render(<DoxPage />);
    await waitFor(() => expect(screen.getByText("● local")).toBeVisible());
    expect(container.querySelector("[data-empty]")).not.toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Message" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
  });
});

describe("DoxPage -- New chat", () => {
  async function askOne() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { runId } = JSON.parse(init.body as string) as { runId: string };
        return new Response(answerStream.replaceAll("RUN-ID", runId), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "How do I remove a worktree?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByRole("article", { name: "Dox" });
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Dox" })).toHaveTextContent(
        "To remove a worktree",
      ),
    );
  }

  it("appears in the strip once there is a transcript, and empties it and shows the hub again when pressed", async () => {
    const { container } = render(<DoxPage />);
    await askOne();
    await waitFor(() =>
      expect(container.querySelector("[data-empty]")).toBeNull(),
    );

    fireEvent.click(await screen.findByRole("button", { name: "New chat" }));

    await waitFor(() =>
      expect(screen.queryAllByRole("article")).toHaveLength(0),
    );
    expect(screen.getByText(/^Ask/, { selector: "p" })).toBeInTheDocument();
    expect(container.querySelector("[data-empty]")).not.toBeNull();
    // The button the reader pressed is gone with the transcript: focus moves to the composer, not to the page.
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();
  });
});

// Phase 8 (plan #309 D10, §4.1 rows 2 and 22, and "Done when"): the page reads `GET /api/brains` after mount, keeps the badge
// current from the Worker's counts after each question, and shows no badge when the Worker cannot be reached.
describe("DoxPage -- the control bar", () => {
  const BRAINS_URL = "http://localhost:8787/api/brains";
  const frame = (name: string, value: unknown) =>
    `data: ${JSON.stringify({ type: "CUSTOM", name, value, timestamp: 1 })}`;

  /** Answers `/api/brains` with `brains` (or a failure) and the chat route with the recorded answer. */
  function stubWorker(
    brains: "down" | "unreadable" | BrainsInfo,
    usage?: BrainsInfo,
  ) {
    const answer = usage
      ? answerStream
          .split("\n\n")
          .flatMap((f, i) => (i === 1 ? [f, frame("dox-usage", usage)] : [f]))
          .join("\n\n")
      : answerStream;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url === BRAINS_URL) {
          if (brains === "down") throw new TypeError("Failed to fetch");
          if (brains === "unreadable")
            return new Response("<html>bad gateway</html>", { status: 502 });
          return new Response(JSON.stringify(brains), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { runId } = JSON.parse(init?.body as string) as { runId: string };
        return new Response(answer.replaceAll("RUN-ID", runId), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );
    return calls;
  }

  async function ask(text: string) {
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByRole("article", { name: "Dox" });
  }

  it("shows the badge once /api/brains answers, with the reader's own allowance and the pool", async () => {
    stubWorker(brainsInfo({ visitorRemaining: 3 }));
    render(<DoxPage />);
    expect(
      await screen.findByRole("button", { name: /You 3 left/ }),
    ).toHaveTextContent("Dox 140 today");
  });

  it.each([
    "down",
    "unreadable",
  ] as const)("shows no badge and no reset chip when /api/brains is %s, and a question still goes through", async (failure) => {
    const calls = stubWorker(failure);
    render(<DoxPage />);
    await waitFor(() => expect(calls).toContain(BRAINS_URL));
    expect(screen.queryByRole("button", { name: /left/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /reset/ })).toBeNull();
    await ask("How do I remove a worktree?");
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Dox" })).toHaveTextContent(
        "To remove a worktree",
      ),
    );
  });

  it("moves the badge to the counts the Worker sends after a question, without reading /api/brains again", async () => {
    const calls = stubWorker(
      brainsInfo({ visitorRemaining: 5 }),
      brainsInfo({ visitorRemaining: 4 }),
    );
    render(<DoxPage />);
    await screen.findByRole("button", { name: /You 5 left/ });
    await ask("How do I remove a worktree?");
    expect(
      await screen.findByRole("button", { name: /You 4 left/ }),
    ).toBeInTheDocument();
    expect(calls.filter((url) => url === BRAINS_URL)).toHaveLength(1);
  });

  it("disables the composer with the resting placeholder and the banner once the budget says the reader is out", async () => {
    stubWorker(brainsInfo({ visitorRemaining: 0 }));
    render(<DoxPage />);
    const banner = await screen.findByText(
      /You have used your 5 questions for today/,
    );
    expect(banner.tagName).toBe("OUTPUT");
    const field = screen.getByRole("textbox", { name: "Message" });
    expect(field).toBeDisabled();
    expect(field).toHaveAttribute(
      "placeholder",
      "Dox is resting until the quota resets…",
    );
  });

  it("shows the local clock in the strip after mount, beside the environment badge", async () => {
    stubWorker("down");
    const { container } = render(<DoxPage />);
    const strip = container.querySelector(".gmt-hive-strip") as HTMLElement;
    await waitFor(() =>
      expect(
        within(strip).getByText(/^(today|tomorrow|yesterday) at /),
      ).toBeInTheDocument(),
    );
    const clock = within(strip).getByText(/ at /);
    expect(clock.tagName).toBe("TIME");
  });

  it("renders nothing time-based on the server: no clock, no chip, no menu, no reset", () => {
    // `renderToString` runs no effects: it is the server's pass, which has no /api/brains answer and no reader's zone.
    const html = renderToString(<DoxPage />);
    expect(html).not.toContain("<time");
    expect(html).not.toContain("gmt-hive-now");
    expect(html).not.toContain("gmt-hive-clock");
    expect(html).not.toContain("gmt-hive-brain");
    expect(html).not.toContain("resets");
  });
});
