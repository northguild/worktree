import {
  CHAT_MIN_REM,
  clampRailWidth,
  KEY_BIG_STEP_PX,
  KEY_STEP_PX,
  RAIL_MAX_SHARE,
  railBounds,
  railWidthForKey,
} from "./rail-width";

// Expected values: the rail's own CSS in `dox-hive.css` (`.gmt-hive-rail`), which `rail-width.ts` mirrors, worked by hand
// at rem = 16: the narrowest is clamp(22rem, 34vw, 34rem) = clamp(352px, 34vw, 544px); the widest is half the body, but
// never so wide that the chat keeps less than 28rem (448px), and never under the narrowest. The step sizes are gmt's
// `rail-width.ts` (one arrow press 16px, with Shift 64px).

const REM = 16;

describe("railBounds", () => {
  it("takes 34% of the window between 22rem and 34rem", () => {
    // 34% of 1440 = 489.6, inside 352..544.
    expect(
      railBounds({ viewportWidth: 1440, bodyWidth: 1440, rem: REM }).min,
    ).toBeCloseTo(489.6, 5);
    // 34% of 1000 = 340, under the 22rem floor of 352.
    expect(
      railBounds({ viewportWidth: 1000, bodyWidth: 1000, rem: REM }).min,
    ).toBe(352);
    // 34% of 2000 = 680, over the 34rem ceiling of 544.
    expect(
      railBounds({ viewportWidth: 2000, bodyWidth: 2000, rem: REM }).min,
    ).toBe(544);
  });

  it("lets the rail grow to half the body while the chat keeps 28rem", () => {
    // Half of 1440 = 720; 1440 - 448 = 992. Half is the smaller.
    expect(
      railBounds({ viewportWidth: 1440, bodyWidth: 1440, rem: REM }).max,
    ).toBe(720);
    // At a 1000px window the narrowest is 352, under every widest below.
    // Half of 900 = 450; 900 - 448 = 452. Half is still the smaller.
    expect(
      railBounds({ viewportWidth: 1000, bodyWidth: 900, rem: REM }).max,
    ).toBe(450);
    // Half of 880 = 440; 880 - 448 = 432. The chat's floor is the smaller.
    expect(
      railBounds({ viewportWidth: 1000, bodyWidth: 880, rem: REM }).max,
    ).toBe(432);
  });

  it("never lets the widest fall under the narrowest, on a window too small for both", () => {
    // Body 700: half 350, 700 - 448 = 252; both are under the narrowest (352 at a 1000px window).
    const bounds = railBounds({
      viewportWidth: 1000,
      bodyWidth: 700,
      rem: REM,
    });
    expect(bounds).toEqual({ min: 352, max: 352 });
  });

  it("names its constants as the numbers the CSS and the arithmetic above use", () => {
    expect(RAIL_MAX_SHARE).toBe(0.5);
    expect(CHAT_MIN_REM).toBe(28);
  });
});

describe("clampRailWidth", () => {
  const bounds = { min: 400, max: 700 };
  it("keeps a width inside the bounds and pulls one outside back to the nearest edge", () => {
    expect(clampRailWidth(500, bounds)).toBe(500);
    expect(clampRailWidth(100, bounds)).toBe(400);
    expect(clampRailWidth(900, bounds)).toBe(700);
  });
});

describe("railWidthForKey", () => {
  const bounds = { min: 400, max: 700 };

  it("steps by one arrow press, 16px, and by 64px with Shift", () => {
    expect(KEY_STEP_PX).toBe(16);
    expect(KEY_BIG_STEP_PX).toBe(64);
  });

  it("widens on ArrowLeft and narrows on ArrowRight, since the rail is on the right", () => {
    expect(railWidthForKey("ArrowLeft", false, 500, bounds)).toBe(
      500 + KEY_STEP_PX,
    );
    expect(railWidthForKey("ArrowRight", false, 500, bounds)).toBe(
      500 - KEY_STEP_PX,
    );
    expect(railWidthForKey("ArrowLeft", true, 500, bounds)).toBe(
      500 + KEY_BIG_STEP_PX,
    );
  });

  it("stays inside the bounds", () => {
    expect(railWidthForKey("ArrowLeft", true, 690, bounds)).toBe(700);
    expect(railWidthForKey("ArrowRight", true, 410, bounds)).toBe(400);
  });

  it("jumps to the narrowest on Home and the widest on End, and ignores any other key", () => {
    expect(railWidthForKey("Home", false, 500, bounds)).toBe(400);
    expect(railWidthForKey("End", false, 500, bounds)).toBe(700);
    expect(railWidthForKey("a", false, 500, bounds)).toBeUndefined();
  });
});
