import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { type ChatModule, initChatLauncher } from "../launcher";

/**
 * The launcher is the seam between a static page and the lazily loaded chat. Expected values come from
 * the phase's scope (plan #235, D6): the first activation, by click or by the shortcut, imports the chat
 * and opens it in one step; a failed import is shown, not swallowed; a static launcher never loads the
 * chat on its own.
 */

/** The markup ChatLauncher.astro renders (its own test pins that markup), as the script receives it. */
function mountLauncher() {
  document.body.innerHTML = `
    <div data-chat-launcher-root>
      <button type="button" aria-label="Open chat" data-chat-launcher></button>
      <div role="alert" data-chat-launcher-status></div>
    </div>`;
  const root = document.querySelector<HTMLElement>("[data-chat-launcher-root]");
  if (!root) throw new Error("launcher markup missing");
  return root;
}

const ALT_SHIFT_C = { key: "C", code: "KeyC", altKey: true, shiftKey: true };

function launcherButton() {
  return screen.getByRole("button", { name: "Open chat" });
}

function setup(
  load: () => Promise<ChatModule> = vi
    .fn()
    .mockResolvedValue({ mountChat: vi.fn() }),
) {
  const root = mountLauncher();
  const dispose = initChatLauncher(root, load);
  return { load, dispose };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ChatLauncher", () => {
  it("loads nothing until it is used", () => {
    const { load } = setup();

    expect(load).not.toHaveBeenCalled();
    expect(launcherButton()).toBeVisible();
  });

  it("imports the chat and opens it in one step on click", async () => {
    const mountChat = vi.fn();
    const { load } = setup(vi.fn().mockResolvedValue({ mountChat }));

    fireEvent.click(launcherButton());

    await waitFor(() => expect(mountChat).toHaveBeenCalledWith({ open: true }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  // Alt+Shift+C, matched on the physical key: on macOS Option+Shift+C types "Ç", so `key` cannot be relied on.
  // Chosen because no browser's documented shortcut list uses it (see shortcut.ts).
  it.each([
    ["Alt+Shift+C", { key: "C", code: "KeyC", altKey: true, shiftKey: true }],
    [
      "Option+Shift+C on macOS",
      { key: "Ç", code: "KeyC", altKey: true, shiftKey: true },
    ],
  ])("does the same on %s before the chat has loaded", async (_name, init) => {
    const mountChat = vi.fn();
    setup(vi.fn().mockResolvedValue({ mountChat }));

    const prevented = !fireEvent.keyDown(window, init);

    await waitFor(() => expect(mountChat).toHaveBeenCalledWith({ open: true }));
    expect(prevented).toBe(true);
  });

  it("leaves other keys alone", () => {
    const { load } = setup();

    const prevented = !fireEvent.keyDown(window, { key: "c", code: "KeyC" });
    fireEvent.keyDown(window, {
      key: "j",
      code: "KeyJ",
      altKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(window, { key: "C", code: "KeyC", altKey: true });
    fireEvent.keyDown(window, {
      key: "C",
      code: "KeyC",
      shiftKey: true,
      ctrlKey: true,
    });

    expect(prevented).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ["Ctrl+K", { key: "k", code: "KeyK", ctrlKey: true }],
    ["Cmd+K", { key: "k", code: "KeyK", metaKey: true }],
  ])("leaves %s to Starlight's search", (_name, init) => {
    const { load } = setup();

    const prevented = !fireEvent.keyDown(window, init);

    expect(prevented).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("imports once however many times it is activated while loading", async () => {
    const mountChat = vi.fn();
    const { load } = setup(vi.fn().mockResolvedValue({ mountChat }));

    fireEvent.click(launcherButton());
    fireEvent.keyDown(window, ALT_SHIFT_C);
    fireEvent.click(launcherButton());

    await waitFor(() => expect(mountChat).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("hands over to the chat's own trigger and shortcut once it has mounted", async () => {
    const mountChat = vi.fn();
    const { load } = setup(vi.fn().mockResolvedValue({ mountChat }));

    fireEvent.click(launcherButton());
    await waitFor(() => expect(mountChat).toHaveBeenCalled());

    expect(
      screen.queryByRole("button", { name: "Open chat" }),
    ).not.toBeInTheDocument();
    // The chat's own listener toggles from here; the launcher must not load or mount again.
    fireEvent.keyDown(window, ALT_SHIFT_C);
    expect(load).toHaveBeenCalledTimes(1);
    expect(mountChat).toHaveBeenCalledTimes(1);
  });

  it("says so when the import fails, keeps the button, and loads on the next try", async () => {
    const mountChat = vi.fn();
    const load = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Failed to fetch dynamically imported module"),
      )
      .mockResolvedValue({ mountChat });
    setup(load);

    fireEvent.click(launcherButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The chat could not be loaded",
    );
    expect(launcherButton()).toBeVisible();
    expect(launcherButton()).not.toHaveAttribute("aria-busy");
    expect(mountChat).not.toHaveBeenCalled();

    fireEvent.click(launcherButton());

    await waitFor(() => expect(mountChat).toHaveBeenCalledWith({ open: true }));
    // The launcher has handed over by now, so its (hidden) status region is empty.
    expect(screen.getByRole("alert", { hidden: true })).toBeEmptyDOMElement();
  });

  it("says so when mounting throws", async () => {
    setup(
      vi.fn().mockResolvedValue({
        mountChat: () => {
          throw new Error("boom");
        },
      }),
    );

    fireEvent.click(launcherButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The chat could not be loaded",
    );
    expect(launcherButton()).toBeVisible();
  });
});

/** jsdom has no `scrollIntoView` and, under this Node, no usable `localStorage`; the chat's scroll and history hooks use both. */
function stubBrowserApis() {
  Element.prototype.scrollIntoView = vi.fn();
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
}

describe("ChatLauncher with the real chat", () => {
  beforeEach(stubBrowserApis);
  afterEach(() => vi.unstubAllGlobals());

  it("opens a named drawer on the first activation, leaving one chat trigger", async () => {
    setup(() => import("./Chat"));

    fireEvent.click(launcherButton());

    const dialog = await screen.findByRole(
      "dialog",
      { name: "Chat with the Worktree CLI docs" },
      { timeout: 15_000 },
    );
    expect(
      within(dialog).getByRole("button", { name: "Close chat" }),
    ).toBeVisible();
    // The static launcher has handed over (it is hidden), so assistive tech meets no stale "Open chat".
    expect(screen.queryByRole("button", { name: "Open chat" })).toBeNull();
  }, 20_000);
});
