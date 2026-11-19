/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSound, stubStorage } from "../../test/sound-storage";
import { mountSoundControl } from "./control";
import { cue } from "./cue";
import { readSound, SOUND_KEY } from "./settings";

// Expected values: plan #352 Phase 5 Done-when and D9. Each value change of the fader plays one `notch` at the new level
// (the engine reads the level when the cue is dispatched, so the level saved at the moment of the cue is what is heard),
// and none on mount or on a repaint from another tab; the mute button toggles `muted`, keeps the level and plays nothing;
// moving the fader while muted unmutes at the new level; `aria-valuetext` reads "Volume 5 of 11" and, muted, "Volume 5 of
// 11, muted". The mute button is named "Mute" and the range "Volume". Unmuting loads the engine a moment later, so the first
// notch after it is cued after that import and one task more (control.ts), as GMT's `mute` does for its toggle cue.
vi.mock("./cue", () => ({ cue: vi.fn() }));
vi.mock("./engine", () => ({}));

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
/** The level on disk at the moment each notch was cued. */
let heardAt: number[];

const fader = () => host.querySelector<HTMLInputElement>("input[type=range]");
const mute = () =>
  host.querySelector<HTMLButtonElement>("#settings-sound-mute");

function mount() {
  host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  destroy = mountSoundControl(host);
}
function slideTo(value: number) {
  const input = fader();
  if (!input) throw new Error("no fader");
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
/** Let the engine import settle and the task after it run. */
async function settle() {
  await vi.dynamicImportSettled();
  vi.runAllTimers();
}

beforeEach(() => {
  vi.useFakeTimers();
  stubStorage();
  heardAt = [];
  vi.mocked(cue).mockReset();
  vi.mocked(cue).mockImplementation(() => {
    heardAt.push(readSound().level);
    return true;
  });
  delete document.documentElement.dataset.sound;
});

afterEach(() => {
  destroy?.();
  host?.remove();
  vi.useRealTimers();
});

describe("the markup", () => {
  it("is a native range of 1 to 11 named Volume, and a button named Mute", () => {
    mount();
    const input = fader();
    expect(input?.min).toBe("1");
    expect(input?.max).toBe("11");
    expect(input?.step).toBe("1");
    expect(input?.getAttribute("aria-label")).toBe("Volume");
    expect(mute()?.getAttribute("aria-label")).toBe("Mute");
    expect(mute()?.tagName).toBe("BUTTON");
    expect(mute()?.hasAttribute("data-cue")).toBe(false);
  });
});

describe("on mount", () => {
  it("shows a first-time reader muted at level 5, plays nothing and writes nothing", () => {
    mount();
    expect(fader()?.value).toBe("5");
    expect(fader()?.getAttribute("aria-valuetext")).toBe(
      "Volume 5 of 11, muted",
    );
    expect(mute()?.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.dataset.sound).toBe("off");
    expect(cue).not.toHaveBeenCalled();
    expect(localStorage.getItem(SOUND_KEY)).toBeNull();
  });

  it("shows a reader who unmuted at 8 as Volume 8 of 11, not muted", () => {
    saveSound({ level: 8 });
    mount();
    expect(fader()?.value).toBe("8");
    expect(fader()?.getAttribute("aria-valuetext")).toBe("Volume 8 of 11");
    expect(mute()?.getAttribute("aria-pressed")).toBe("false");
    expect(document.documentElement.dataset.sound).toBe("on");
    expect(cue).not.toHaveBeenCalled();
  });

  it("sets the stem's level, which draws it", () => {
    saveSound({ level: 8 });
    mount();
    expect(
      host
        .querySelector<HTMLElement>(".stem-fader")
        ?.style.getPropertyValue("--level"),
    ).toBe("8");
  });
});

describe("the fader", () => {
  beforeEach(() => saveSound({ level: 5 }));

  it("plays one notch per change, at the new level", async () => {
    mount();
    slideTo(8);
    expect(cue).toHaveBeenCalledTimes(1);
    expect(cue).toHaveBeenLastCalledWith("notch");
    expect(heardAt).toEqual([8]);
    slideTo(7);
    expect(cue).toHaveBeenCalledTimes(2);
    expect(heardAt).toEqual([8, 7]);
    await settle();
    expect(cue).toHaveBeenCalledTimes(2);
  });

  it("keeps the level and stays unmuted", () => {
    mount();
    slideTo(8);
    expect(readSound()).toEqual({ level: 8, muted: false });
    expect(fader()?.getAttribute("aria-valuetext")).toBe("Volume 8 of 11");
  });

  it("repaints the stem to the new level", () => {
    mount();
    slideTo(9);
    expect(
      host
        .querySelector<HTMLElement>(".stem-fader")
        ?.style.getPropertyValue("--level"),
    ).toBe("9");
  });

  it("while muted, unmutes at the new level and plays its notch after the engine has loaded", async () => {
    saveSound({ level: 5, muted: true });
    mount();
    slideTo(3);
    expect(readSound()).toEqual({ level: 3, muted: false });
    expect(mute()?.getAttribute("aria-pressed")).toBe("false");
    expect(fader()?.getAttribute("aria-valuetext")).toBe("Volume 3 of 11");
    expect(document.documentElement.dataset.sound).toBe("on");
    // Not yet: the engine is still loading, and a cue before it is dropped.
    expect(cue).not.toHaveBeenCalled();
    await settle();
    expect(cue).toHaveBeenCalledTimes(1);
    expect(cue).toHaveBeenCalledWith("notch");
    expect(heardAt).toEqual([3]);
  });
});

describe("the mute button", () => {
  it("mutes, keeps the level and plays nothing", async () => {
    saveSound({ level: 8 });
    mount();
    mute()?.click();
    await settle();
    expect(readSound()).toEqual({ level: 8, muted: true });
    expect(mute()?.getAttribute("aria-pressed")).toBe("true");
    expect(fader()?.value).toBe("8");
    expect(fader()?.getAttribute("aria-valuetext")).toBe(
      "Volume 8 of 11, muted",
    );
    expect(document.documentElement.dataset.sound).toBe("off");
    expect(cue).not.toHaveBeenCalled();
  });

  it("unmutes at the kept level and plays nothing", async () => {
    saveSound({ level: 8, muted: true });
    mount();
    mute()?.click();
    await settle();
    expect(readSound()).toEqual({ level: 8, muted: false });
    expect(mute()?.getAttribute("aria-pressed")).toBe("false");
    expect(document.documentElement.dataset.sound).toBe("on");
    expect(cue).not.toHaveBeenCalled();
  });
});

describe("another tab", () => {
  it("repaints the control and plays nothing", async () => {
    saveSound({ level: 5 });
    mount();
    saveSound({ level: 10, muted: true });
    window.dispatchEvent(new StorageEvent("storage", { key: SOUND_KEY }));
    await settle();
    expect(fader()?.value).toBe("10");
    expect(fader()?.getAttribute("aria-valuetext")).toBe(
      "Volume 10 of 11, muted",
    );
    expect(mute()?.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.dataset.sound).toBe("off");
    expect(
      host
        .querySelector<HTMLElement>(".stem-fader")
        ?.style.getPropertyValue("--level"),
    ).toBe("10");
    expect(cue).not.toHaveBeenCalled();
  });
});

describe("destroy", () => {
  it("stops listening to the fader, the button and storage", async () => {
    saveSound({ level: 5 });
    mount();
    destroy();
    slideTo(9);
    mute()?.click();
    saveSound({ level: 2 });
    window.dispatchEvent(new StorageEvent("storage", { key: SOUND_KEY }));
    await settle();
    expect(cue).not.toHaveBeenCalled();
    expect(readSound().level).toBe(2);
    expect(fader()?.getAttribute("aria-valuetext")).toBe("Volume 5 of 11");
  });
});
