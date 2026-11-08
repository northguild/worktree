import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { Chat } from "./Chat";

// Expected values: plan #257 D14 (the boundary sits inside Chat, around the provider and drawer) and D18 (role="alert").

// The provider reads localStorage, which this jsdom lacks; the drawer is what fails here.
vi.mock("./ChatContext", () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./ChatDrawer", () => ({
  ChatDrawer: () => {
    throw new Error("render failed");
  },
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Chat", () => {
  it("answers a render error with an alert instead of unmounting the island", () => {
    render(<Chat />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The chat hit an error.",
    );
  });
});
