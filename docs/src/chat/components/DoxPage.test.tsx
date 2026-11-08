import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, vi } from "vitest";
import { DoxPage } from "./DoxPage";

// Expected values: plan #309 Phase 1 "Done when" (the prompt line and an aria-hidden crystal SVG) and §4.1 rows 1, 3
// and 7 (the empty hub, the environment badge `● local` / `● live` with a title, and the prompt line "Ask Dox about
// ... in @northguild/worktree"). The wording of the prompt line is the plan's §9 Q9 ("worktree wording").

afterEach(() => {
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
    const crystals = container.querySelectorAll("svg");
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

  it("holds the hub in the body, marked empty, with no chat controls yet", async () => {
    const { container } = render(<DoxPage />);
    await waitFor(() => expect(screen.getByText("● local")).toBeVisible());
    expect(container.querySelector("[data-empty]")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
