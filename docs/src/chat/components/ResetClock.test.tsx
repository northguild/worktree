import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { ResetClockState } from "../time/use-reset-clock";
import { brainsInfo } from "./brains.fixture";
import { ResetClock } from "./ResetClock";

// Expected values: plan #309 §4.1 row 21 (a chip with the reset; a popover with zone search and the formats, each showing
// the gmt call that made it) and D13. The chip's text is gmt's documented output for the preset's call
// (`formatCalendarUtc`'s page: a value the day after the reference reads "tomorrow at <time>"), worked by hand: now is
// 12:00 PM on June 15 in Los Angeles (2026-06-15T19:00Z, PDT is UTC-7), and the reader's own questions refill at the UTC
// midnight, 2026-06-16T00:00Z, which is 5:00 PM on June 15 there: "today at 5:00 PM". Pacific midnight is "tomorrow at
// 12:00 AM". When every brain and the reader's questions are spent the chip shows the later reset (quota-resets.test.ts).
const LOS_ANGELES: ResetClockState = {
  ready: true,
  zone: "America/Los_Angeles",
  formatId: "calendar",
  locale: "en-US",
  now: "2026-06-15T19:00:00Z",
  zones: ["UTC", "America/Los_Angeles", "America/New_York", "Asia/Tokyo"],
  setZone: () => {},
  setFormatId: () => {},
};

function chip() {
  return screen.getByRole("button", { name: /reset/ });
}
function openPanel() {
  fireEvent.click(chip());
}

describe("ResetClock", () => {
  it("renders nothing until the reader's zone is known", () => {
    const { container } = render(
      <ResetClock
        info={brainsInfo()}
        clock={{ ...LOS_ANGELES, ready: false, now: "" }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a budget to read", () => {
    const { container } = render(
      <ResetClock info={null} clock={LOS_ANGELES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the reader's own reset in their zone and the chosen format, and says so in its name", () => {
    render(<ResetClock info={brainsInfo()} clock={LOS_ANGELES} />);
    expect(chip()).toHaveTextContent("today at 5:00 PM");
    expect(chip()).toHaveAccessibleName(
      "Your questions reset today at 5:00 PM. Change the zone or format.",
    );
  });

  it("follows the chosen format", () => {
    render(
      <ResetClock
        info={brainsInfo()}
        clock={{ ...LOS_ANGELES, formatId: "http" }}
      />,
    );
    expect(chip()).toHaveTextContent("Tue, 16 Jun 2026 00:00:00 GMT");
  });

  it("shows the pool's reset instead when every brain is spent", () => {
    render(
      <ResetClock
        info={brainsInfo({
          remaining: {
            "cf-gemma-4-26b": 0,
            "cf-glm-4.7-flash": 0,
            "gemini-3.5-flash-lite": 0,
            "gemini-3.6-flash": 0,
            "gemini-3.5-flash": 0,
          },
        })}
        clock={LOS_ANGELES}
      />,
    );
    // Workers AI is back first (00:00Z), the pool's soonest: 5:00 PM today in Los Angeles.
    expect(chip()).toHaveAccessibleName(/^Workers AI reset today at 5:00 PM/);
  });

  it("lists every reset in the panel, each on its own clock, marking the one the chip shows", () => {
    render(<ResetClock info={brainsInfo()} clock={LOS_ANGELES} />);
    openPanel();
    const panel = screen.getByRole("dialog", { name: "Quota resets" });
    const rows = within(panel)
      .getAllByRole("term")
      .map((term) => [
        term.textContent,
        term.nextElementSibling?.textContent,
        term.parentElement?.hasAttribute("data-current"),
      ]);
    expect(rows).toEqual([
      ["Your questions", "today at 5:00 PM", true],
      ["Workers AI", "today at 5:00 PM", false],
      ["Gemini", "tomorrow at 12:00 AM", false],
    ]);
  });

  it("offers every format as a radio, the picked one checked, each with the function it calls", () => {
    render(<ResetClock info={brainsInfo()} clock={LOS_ANGELES} />);
    openPanel();
    const group = screen.getByRole("group", { name: "Format" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(10);
    expect(
      within(group).getByRole("radio", { name: /^Calendar/ }),
    ).toBeChecked();
    expect(
      within(group).getByRole("radio", { name: /HTTP date/ }),
    ).not.toBeChecked();
    expect(within(group).getByText("formatHttpDate")).toBeInTheDocument();
  });

  it("reports a format pick", () => {
    const setFormatId = vi.fn();
    render(
      <ResetClock
        info={brainsInfo()}
        clock={{ ...LOS_ANGELES, setFormatId }}
      />,
    );
    openPanel();
    fireEvent.click(screen.getByRole("radio", { name: /Unix seconds/ }));
    expect(setFormatId).toHaveBeenCalledExactlyOnceWith("unix-s");
  });

  it("searches the zones, finding 'new york' for America/New_York, and reports a pick", () => {
    const setZone = vi.fn();
    render(
      <ResetClock info={brainsInfo()} clock={{ ...LOS_ANGELES, setZone }} />,
    );
    openPanel();
    const search = screen.getByRole("combobox", { name: "Time zone" });
    expect(screen.getAllByRole("option")).toHaveLength(4);
    fireEvent.change(search, { target: { value: "new york" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["America/New_York"]);
    fireEvent.click(options[0] as HTMLElement);
    expect(setZone).toHaveBeenCalledExactlyOnceWith("America/New_York");
  });

  it("says when no zone matches", () => {
    render(<ResetClock info={brainsInfo()} clock={LOS_ANGELES} />);
    openPanel();
    fireEvent.change(screen.getByRole("combobox", { name: "Time zone" }), {
      target: { value: "atlantis" },
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No zone matches.")).toBeInTheDocument();
  });

  it("names the current zone and marks it in the list", () => {
    render(<ResetClock info={brainsInfo()} clock={LOS_ANGELES} />);
    openPanel();
    expect(screen.getByRole("heading", { name: /^Zone/ })).toHaveTextContent(
      "America/Los_Angeles",
    );
    expect(
      screen.getByRole("option", { name: "America/Los_Angeles" }),
    ).toHaveAttribute("data-current");
  });

  it("disables the zone search for a format the zone cannot change, and says so", () => {
    render(
      <ResetClock
        info={brainsInfo()}
        clock={{ ...LOS_ANGELES, formatId: "http" }}
      />,
    );
    openPanel();
    const search = screen.getByRole("combobox", { name: "Time zone" });
    expect(search).toBeDisabled();
    expect(search).toHaveAttribute("placeholder", "Same in every zone");
  });

  it("links the live call to gmt's reference page, in a new tab", () => {
    render(<ResetClock info={brainsInfo()} clock={LOS_ANGELES} />);
    openPanel();
    const link = screen.getByRole("link", { name: /formatCalendarUtc/ });
    expect(link).toHaveTextContent(
      'formatCalendarUtc(resetsAt, "en-US", { timeZone: "America/Los_Angeles" })',
    );
    expect(link).toHaveAttribute(
      "href",
      "https://northguild.dev/gmt/reference/utc/format/formatCalendarUtc/",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(link).toHaveAccessibleName(/opens the reference in a new tab/);
  });

  it("closes on Escape and returns focus to the chip", async () => {
    render(<ResetClock info={brainsInfo()} clock={LOS_ANGELES} />);
    openPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await vi.waitFor(() => expect(chip()).toHaveFocus());
  });
});
