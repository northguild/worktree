import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RetrievalTraceData } from "../lib/chat-types";
import { describeTimings, formatMs, RetrievalTrace } from "./RetrievalTrace";

// Expected values: plan #309 §4.1 row 12 ("Searched N chunks → M matched · brain"; open: chunk titles, stage timings;
// "Nothing in the corpus matched this question."), D4 (Base UI's Collapsible), and Phase 5 "Done when" ("The trace
// renders collapsed, with the counts"). The millisecond format is gmt's: "320 ms" below a second, "0.4 s" above.

afterEach(cleanup);

const DATA: RetrievalTraceData = {
  totalChunks: 210,
  retrievedCount: 2,
  chunkTitles: ["Cleanup › Usage", "Cleanup › Flags"],
  chunkUrls: ["/commands/cleanup/"],
  timings: { corpus: 0, search: 4, prompt: 1, firstToken: 900, total: 1500 },
};

describe("RetrievalTrace", () => {
  it("renders collapsed, with the counts", () => {
    render(<RetrievalTrace data={DATA} />);

    const trigger = screen.getByRole("button", {
      name: "Searched 210 chunks → 2 matched",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Cleanup › Usage")).toBeNull();
  });

  it("opens to the chunk titles and the stage timings, and closes again", () => {
    render(<RetrievalTrace data={DATA} />);
    const trigger = screen.getByRole("button", { name: /Searched 210 chunks/ });

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Cleanup › Usage")).toBeInTheDocument();
    expect(screen.getByText("Cleanup › Flags")).toBeInTheDocument();
    expect(
      screen.getByText(
        "index 0 ms · search 4 ms · prompt 1 ms · first token 900 ms · total 1.5 s",
      ),
    ).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("names the brain after the counts when the Worker names one", () => {
    render(
      <RetrievalTrace
        data={{ ...DATA, brainLabel: "Gemini 3.5 Flash-Lite" }}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Searched 210 chunks → 2 matched · Gemini 3.5 Flash-Lite",
      }),
    ).toBeInTheDocument();
  });

  it("says so, in words, when nothing matched, and lists no chunk", () => {
    render(
      <RetrievalTrace
        data={{ ...DATA, retrievedCount: 0, chunkTitles: [], chunkUrls: [] }}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Searched 210 chunks → 0 matched",
    });
    fireEvent.click(trigger);

    expect(
      screen.getByText("Nothing in the corpus matched this question."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows only the stages it has: the first write has no first token or total", () => {
    render(
      <RetrievalTrace
        data={{ ...DATA, timings: { corpus: 12, search: 4, prompt: 1 } }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Searched/ }));

    expect(
      screen.getByText("index 12 ms · search 4 ms · prompt 1 ms"),
    ).toBeInTheDocument();
  });

  it("lists the same title twice when two chunks share one", () => {
    render(
      <RetrievalTrace
        data={{ ...DATA, retrievedCount: 2, chunkTitles: ["A", "A"] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Searched/ }));

    expect(screen.getAllByText("A")).toHaveLength(2);
  });

  it("is a button the keyboard reaches, named by its summary and not by its icons", () => {
    render(<RetrievalTrace data={DATA} />);

    const trigger = screen.getByRole("button", { name: /Searched/ });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(2);
  });
});

describe("formatMs", () => {
  it.each([
    [0, "0 ms"],
    [320, "320 ms"],
    [999.4, "999 ms"],
    [1000, "1.0 s"],
    [1500, "1.5 s"],
    [20_000, "20.0 s"],
  ])("%s is %s", (ms, text) => {
    expect(formatMs(ms)).toBe(text);
  });
});

describe("describeTimings", () => {
  it("lists the stages in the order the Worker runs them", () => {
    expect(
      describeTimings({
        corpus: 1,
        search: 2,
        prompt: 3,
        firstToken: 4,
        total: 5,
      }),
    ).toBe(
      "index 1 ms · search 2 ms · prompt 3 ms · first token 4 ms · total 5 ms",
    );
  });
});
