import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, vi } from "vitest";
import answerStream from "../hooks/fixtures/chat-answer.sse?raw";
import { DoxPage } from "./DoxPage";

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
