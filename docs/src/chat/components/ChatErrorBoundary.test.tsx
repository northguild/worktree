import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { ChatErrorBoundary } from "./ChatErrorBoundary";

// Expected values: plan #257 Phase 6 and D18. A child that throws gives a role="alert" notice; a failed dynamic
// import offers "Reload the page", anything else says "The chat hit an error." with a reset button.

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

beforeEach(() => {
  // React logs a caught render error and the boundary logs it too; keep the run quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ChatErrorBoundary", () => {
  it("renders its children while nothing throws", () => {
    render(
      <ChatErrorBoundary>
        <p>all well</p>
      </ChatErrorBoundary>,
    );
    expect(screen.getByText("all well")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers a reload for a stale chunk", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(
      <ChatErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: /chunk.js" />
      </ChatErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("site was updated");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload the page" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("says the chat hit an error and offers a reset otherwise", () => {
    let broken = true;
    function Child() {
      if (broken) throw new Error("undefined is not a function");
      return <p>back</p>;
    }
    render(
      <ChatErrorBoundary>
        <Child />
      </ChatErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The chat hit an error.",
    );
    expect(
      screen.queryByRole("button", { name: "Reload the page" }),
    ).toBeNull();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("back")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
