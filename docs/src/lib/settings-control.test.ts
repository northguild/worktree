/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSettingsControl } from "./settings-control";
import { THEME_KEY } from "./theme";

// Expected values: plan #352 Phase 2 Scope. The gear is a button named "Settings" that opens a popover (`popovertarget`);
// its `aria-expanded` follows the popover's `toggle` event (the browser's own event, `newState` "open" or "closed");
// opening moves focus to the "Dark theme" switch, a checkbox with role="switch" (APG Switch); Escape and the return of
// focus to the gear are the browser's, which jsdom does not implement, so they are not asserted here (the browser pass in
// the plan's section 8 does). The theme rule itself is `theme.ts`'s, tested in theme.test.ts.

// The component's own markup, read from the source (vitest runs from docs/): vitest here cannot render a `.astro` file (the container finds no
// renderer for it), and the markup has no expression but the gear, which is an icon and not behaviour.
const source = readFileSync(
  resolve(process.cwd(), "src/components/SettingsControl.astro"),
  "utf8",
);
const markup = source
  .slice(
    source.indexOf("---", source.indexOf("---") + 3) + 3,
    source.indexOf("<script>"),
  )
  .replace("<Fragment set:html={GEAR} />", "");

let host: HTMLElement;
let destroy: () => void;
const stubStorage = (): void => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
};

beforeEach(() => {
  stubStorage();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  // jsdom hides a `[popover]` that is not open, and a hidden control cannot take focus.
  host
    .querySelector<HTMLElement>("[popover]")
    ?.style.setProperty("display", "grid");
  destroy = mountSettingsControl(host);
});

afterEach(() => {
  destroy();
  host.remove();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

/** What the browser does when the popover opens or closes. */
function toggle(state: "open" | "closed"): void {
  const popover = host.querySelector("[popover]");
  popover?.dispatchEvent(
    Object.assign(new Event("toggle"), { newState: state }),
  );
}

const gear = () => host.querySelector<HTMLButtonElement>("button");
const dark = () => host.querySelector<HTMLInputElement>('input[role="switch"]');

describe("the settings control", () => {
  it("is one button named Settings that opens the popover, and one panel named Settings", () => {
    expect(
      [...host.querySelectorAll("button")].filter(
        (b) => b.getAttribute("aria-label") === "Settings",
      ),
    ).toHaveLength(1);
    expect(gear()?.getAttribute("aria-label")).toBe("Settings");
    const id = gear()?.getAttribute("popovertarget");
    const panel = host.querySelector(`#${id}`);
    expect(panel?.hasAttribute("popover")).toBe(true);
    expect(panel?.getAttribute("aria-label")).toBe("Settings");
  });

  it("holds the Dark theme switch, a native checkbox with the switch role, named by its label", () => {
    expect(dark()?.type).toBe("checkbox");
    expect(dark()?.closest("label")?.textContent?.trim()).toBe("Dark theme");
  });

  // Phase 5 adds the volume row (D9; its behaviour is tested in sound/control.test.ts): a mute button and a range.
  // Phase 7 adds the aura (D14; sound/control.test.ts): the Aura switch and the "Aura track" pair of radios. Inputs:
  // theme switch 1 + volume range 1 + Aura switch 1 + 2 radios = 5; the one button is the mute button.
  it("holds the Dark theme switch, the volume row and the aura's switch and track pair, and nothing else", () => {
    expect(host.querySelectorAll("[popover] input")).toHaveLength(5);
    expect(host.querySelectorAll("[popover] input[role=switch]")).toHaveLength(
      2,
    );
    expect(host.querySelectorAll("[popover] input[type=radio]")).toHaveLength(
      2,
    );
    expect(host.querySelectorAll("[popover] input[type=range]")).toHaveLength(
      1,
    );
    expect(host.querySelectorAll("[popover] button")).toHaveLength(1);
  });

  it("tells the gear whether the panel is open, from the toggle event", () => {
    expect(gear()?.getAttribute("aria-expanded")).toBe("false");
    toggle("open");
    expect(gear()?.getAttribute("aria-expanded")).toBe("true");
    toggle("closed");
    expect(gear()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("moves focus to the Dark theme switch on open, and not on close", () => {
    gear()?.focus();
    toggle("open");
    expect(document.activeElement).toBe(dark());
    gear()?.focus();
    toggle("closed");
    expect(document.activeElement).toBe(gear());
  });

  it("wires the switch to the theme rule: the opposite of what shows is saved, and the page flips", () => {
    // The system is dark (matchMedia reports no light preference) and nothing is saved, so the switch shows on.
    expect(dark()?.checked).toBe(true);
    dark()?.click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("stops listening when destroyed", () => {
    destroy();
    dark()?.click();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("does nothing without the markup", () => {
    expect(() =>
      mountSettingsControl(document.createElement("div"))(),
    ).not.toThrow();
  });
});

describe("the markup carries no sound", () => {
  it("has no audio element and no data-ping or sound attribute", () => {
    expect(markup).not.toMatch(/<audio|data-ping|data-sound/);
  });
});
