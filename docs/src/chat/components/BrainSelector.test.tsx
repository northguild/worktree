import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { vi } from "vitest";
import type { ResetClockState } from "../time/use-reset-clock";
import { BrainSelector } from "./BrainSelector";
import { brainsInfo } from "./brains.fixture";

// Expected values: plan #309 §4.1 row 22 (the badge names the active brain with "You N left"; the menu is grouped by
// provider, each group with its reset time in the reader's zone; "Automatic"; "N left" or out per brain) and Phase 8's
// "Done when" (the menu's groups headed by provider with the reset time in the reader's zone; "Automatic" sending no brain id).
//
// The reset text is the calendar preset (`formatCalendarUtc`'s reference page: a value on the same calendar day as the
// reference reads "today", on the next "tomorrow", then "at" the time). Worked by hand: now is 12:00 PM on June 15 in Los
// Angeles (2026-06-15T19:00Z, PDT is UTC-7); Pacific midnight (07:00Z the 16th) is 12:00 AM on June 16 there, tomorrow;
// the UTC midnight (00:00Z the 16th) is 5:00 PM on June 15, today.
const LOS_ANGELES: ResetClockState = {
  ready: true,
  zone: "America/Los_Angeles",
  formatId: "calendar",
  locale: "en-US",
  now: "2026-06-15T19:00:00Z",
  zones: [],
  setZone: () => {},
  setFormatId: () => {},
};
const NOT_READY: ResetClockState = { ...LOS_ANGELES, ready: false, now: "" };

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /left/ }));
}

describe("BrainSelector", () => {
  it("renders nothing without a budget to read", () => {
    const { container } = render(
      <BrainSelector
        info={null}
        selectedId={null}
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active brain, the reader's own allowance and what the pool has left", () => {
    render(
      <BrainSelector
        info={brainsInfo({ visitorRemaining: 3 })}
        selectedId={null}
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    const badge = screen.getByRole("button", { name: /left/ });
    expect(badge).toHaveTextContent("Gemma 4 26B");
    // 40 + 40 + 20 + 20 + 20 left across the five brains.
    expect(badge).toHaveTextContent("You 3 left · Dox 140 today");
  });

  it("sums the pool from what each brain has left", () => {
    render(
      <BrainSelector
        info={brainsInfo({
          remaining: { "cf-gemma-4-26b": 0, "gemini-3.5-flash": 7 },
        })}
        selectedId={null}
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    // 0 + 40 + 20 + 20 + 7.
    expect(screen.getByRole("button", { name: /left/ })).toHaveTextContent(
      "Dox 87 today",
    );
  });

  it("names the picked brain rather than the automatic one", () => {
    render(
      <BrainSelector
        info={brainsInfo()}
        selectedId="gemini-3.6-flash"
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    expect(screen.getByRole("button", { name: /left/ })).toHaveTextContent(
      "3.6 Flash",
    );
  });

  it("opens a menu with Automatic first, then each provider's brains under a heading with its reset in the reader's zone", () => {
    render(
      <BrainSelector
        info={brainsInfo()}
        selectedId={null}
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    openMenu();
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "Automaticwhichever has budget",
      "Gemma 4 26B40 left",
      "GLM 4.7 Flash40 left",
      "3.5 Flash-Lite20 left",
      "3.6 Flash20 left",
      "3.5 Flash20 left",
    ]);
    expect(
      within(menu).getByText("Workers AI").parentElement,
    ).toHaveTextContent("Workers AIresets today at 5:00 PM");
    expect(within(menu).getByText("Gemini").parentElement).toHaveTextContent(
      "Geminiresets tomorrow at 12:00 AM",
    );
  });

  it("names each provider's group for assistive technology by its heading", () => {
    render(
      <BrainSelector
        info={brainsInfo()}
        selectedId={null}
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    openMenu();
    expect(
      screen.getByRole("group", { name: /^Workers AI/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Gemini/ })).toBeInTheDocument();
  });

  it("skips a provider with no brains on this deployment", () => {
    const info = brainsInfo();
    info.brains = info.brains.filter((brain) => brain.provider === "google");
    render(
      <BrainSelector
        info={info}
        selectedId={null}
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    openMenu();
    expect(screen.queryByText("Workers AI")).toBeNull();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
  });

  it("leaves the reset out of the headings until the reader's zone is known", () => {
    render(
      <BrainSelector
        info={brainsInfo()}
        selectedId={null}
        onSelect={() => {}}
        clock={NOT_READY}
      />,
    );
    openMenu();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
    expect(screen.queryByText(/resets/)).toBeNull();
  });

  it("marks a brain that is out today, and keeps it pickable", () => {
    const onSelect = vi.fn();
    render(
      <BrainSelector
        info={brainsInfo({
          remaining: { "gemini-3.6-flash": 0, "cf-glm-4.7-flash": 0 },
          states: {
            "gemini-3.6-flash": "spent",
            "cf-glm-4.7-flash": "unavailable",
          },
        })}
        selectedId={null}
        onSelect={onSelect}
        clock={LOS_ANGELES}
      />,
    );
    openMenu();
    const spent = screen.getByRole("menuitemradio", { name: /^3\.6 Flash/ });
    expect(spent).toHaveTextContent("spent today");
    expect(spent).toHaveAttribute("data-brain-state", "spent");
    expect(
      screen.getByRole("menuitemradio", { name: /GLM/ }),
    ).toHaveTextContent("not available");
    fireEvent.click(spent);
    expect(onSelect).toHaveBeenCalledWith("gemini-3.6-flash");
  });

  it("reports a pick by its brain id, and closes the menu", () => {
    const onSelect = vi.fn();
    render(
      <BrainSelector
        info={brainsInfo()}
        selectedId={null}
        onSelect={onSelect}
        clock={LOS_ANGELES}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Flash-Lite/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("gemini-3.5-flash-lite");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("checks Automatic when nothing is picked, and reports it as no brain at all", () => {
    const onSelect = vi.fn();
    render(
      <BrainSelector
        info={brainsInfo()}
        selectedId="gemini-3.6-flash"
        onSelect={onSelect}
        clock={LOS_ANGELES}
      />,
    );
    openMenu();
    expect(
      screen.getByRole("menuitemradio", { name: /Automatic/ }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("menuitemradio", { name: /3\.6 Flash/ }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Automatic/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("checks Automatic by default", () => {
    render(
      <BrainSelector
        info={brainsInfo()}
        selectedId={null}
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    openMenu();
    expect(
      screen.getByRole("menuitemradio", { name: /Automatic/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("closes on Escape and returns focus to the badge", async () => {
    render(
      <BrainSelector
        info={brainsInfo()}
        selectedId={null}
        onSelect={() => {}}
        clock={LOS_ANGELES}
      />,
    );
    openMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    // Base UI hands focus back once the popup has unmounted.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /left/ })).toHaveFocus(),
    );
  });
});
