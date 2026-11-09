import {
  DEFAULT_RESET_FORMAT_ID,
  findResetFormat,
  isResetFormatId,
  liveClockFormat,
  RESET_FORMATS,
  type ResetFormatContext,
} from "./reset-formats";

// Expected values: `@northguild/gmt`'s reference pages (gmt apps/dox `dist/reference/utc/...`, the same pages the links
// below point at), never `reset-formats.ts`. Each worked example is the page's own; where a preset's call adds an option the
// page's example lacks, the value is derived from the page's stated behaviour and the derivation is written beside it.
//
//   formatCalendarUtc("2026-03-16T18:30:00Z", "en-US", { timeZone: "America/New_York", reference: "2026-03-15T13:00:00Z" })
//     // "tomorrow at 2:30 PM"
//   formatUtc("2026-03-16T18:30:00Z") // "3/16/2026, 6:30:00 PM"   (the default zone is UTC; `includeTimeZoneName` appends a short zone name)
//   formatRelativeUtc("2026-01-15T14:30:45Z", "en-US", { reference: "2026-04-15T14:30:45Z" }) // "3 months ago"
//     (the options table: style "long" is "in 3 months", "short" is "in 3 mo.")
//   formatHttpDate("2024-03-15T14:30:00Z") // "Fri, 15 Mar 2024 14:30:00 GMT"
//   convertUtcToZoned("2024-02-29T00:00:00Z", "America/New_York") // "2024-02-28T19:00:00-05:00[America/New_York]"
//   convertUtcToUnix("2024-02-29T00:00:00Z") // 1709164800000   (seconds: the documented `epochUnit`, 1709164800)

const NEW_YORK: ResetFormatContext = {
  timeZone: "America/New_York",
  locale: "en-US",
  // The calendar page's reference instant: 9:00 AM in New York, the day before the value.
  now: "2026-03-15T13:00:00Z",
};
const TOMORROW_1830Z = "2026-03-16T18:30:00Z";

function format(id: string, value: string, ctx: ResetFormatContext) {
  return findResetFormat(id).format(value, ctx);
}

describe("the presets' output for a fixed instant and zone (plan #309 §8)", () => {
  it("calendar: 'tomorrow at 2:30 PM' for 18:30Z in New York the day after 'now'", () => {
    expect(format("calendar", TOMORROW_1830Z, NEW_YORK)).toBe(
      "tomorrow at 2:30 PM",
    );
  });

  it("local: the page's default text moved into the zone, with its short name (18:30Z is 2:30 PM EDT after the March 8 change)", () => {
    expect(format("local", TOMORROW_1830Z, NEW_YORK)).toBe(
      "3/16/2026, 2:30:00 PM EDT",
    );
  });

  it("utc: the page's default text, zone named, whatever zone the reader chose", () => {
    expect(format("utc", TOMORROW_1830Z, NEW_YORK)).toBe(
      "3/16/2026, 6:30:00 PM UTC",
    );
  });

  it("relative long and short, three months ahead of 'now' (the options table's 'in 3 months' and 'in 3 mo.')", () => {
    const ctx = { ...NEW_YORK, now: "2026-04-15T14:30:45Z" };
    expect(format("relative-long", "2026-07-15T14:30:45Z", ctx)).toBe(
      "in 3 months",
    );
    expect(format("relative-short", "2026-07-15T14:30:45Z", ctx)).toBe(
      "in 3 mo.",
    );
  });

  it("relative long, three months behind 'now' (the page's example)", () => {
    const ctx = { ...NEW_YORK, now: "2026-04-15T14:30:45Z" };
    expect(format("relative-long", "2026-01-15T14:30:45Z", ctx)).toBe(
      "3 months ago",
    );
  });

  it("relative narrow: the locale's most compact form, which the page gives no example of, so only its shape is pinned", () => {
    const ctx = { ...NEW_YORK, now: "2026-04-15T14:30:45Z" };
    const narrow = format("relative-narrow", "2026-07-15T14:30:45Z", ctx);
    expect(narrow).toMatch(/3/);
    expect(narrow.length).toBeLessThanOrEqual(
      format("relative-short", "2026-07-15T14:30:45Z", ctx).length,
    );
  });

  it("iso-zoned: the page's RFC 9557 string", () => {
    expect(format("iso-zoned", "2024-02-29T00:00:00Z", NEW_YORK)).toBe(
      "2024-02-28T19:00:00-05:00[America/New_York]",
    );
  });

  it("http: the page's IMF-fixdate", () => {
    expect(format("http", "2024-03-15T14:30:00Z", NEW_YORK)).toBe(
      "Fri, 15 Mar 2024 14:30:00 GMT",
    );
  });

  it("unix milliseconds and seconds: the page's epoch, in each unit", () => {
    expect(format("unix-ms", "2024-02-29T00:00:00Z", NEW_YORK)).toBe(
      "1709164800000",
    );
    expect(format("unix-s", "2024-02-29T00:00:00Z", NEW_YORK)).toBe(
      "1709164800",
    );
  });

  it("returns gmt's empty string for an instant that is not one, whatever the preset", () => {
    for (const preset of RESET_FORMATS) {
      expect(preset.format("not an instant", NEW_YORK), preset.id).toBe("");
    }
  });

  it("gives the same text in every zone for a preset that says the zone does not matter", () => {
    const tokyo = { ...NEW_YORK, timeZone: "Asia/Tokyo" };
    for (const preset of RESET_FORMATS.filter((p) => !p.zoned)) {
      expect(preset.format(TOMORROW_1830Z, tokyo), preset.id).toBe(
        preset.format(TOMORROW_1830Z, NEW_YORK),
      );
    }
  });

  it("changes with the zone for a preset that says it does", () => {
    const tokyo = { ...NEW_YORK, timeZone: "Asia/Tokyo" };
    for (const preset of RESET_FORMATS.filter((p) => p.zoned)) {
      expect(preset.format(TOMORROW_1830Z, tokyo), preset.id).not.toBe(
        preset.format(TOMORROW_1830Z, NEW_YORK),
      );
    }
  });

  it("marks exactly calendar, local and iso-zoned as zoned (the reference pages: only these three read a zone)", () => {
    expect(RESET_FORMATS.filter((p) => p.zoned).map((p) => p.id)).toEqual([
      "calendar",
      "local",
      "iso-zoned",
    ]);
  });
});

describe("the call each preset shows and the reference it links to (plan #309 §4.1 row 21, §9 Q11)", () => {
  // Written from the signatures on the reference pages: `resetsAt` stands for the instant, `reference` is left out
  // because it defaults to now.
  const CALLS: Array<[string, string]> = [
    [
      "calendar",
      'formatCalendarUtc(resetsAt, "en-US", { timeZone: "America/New_York" })',
    ],
    [
      "local",
      'formatUtc(resetsAt, "en-US", { timeZone: "America/New_York", includeTimeZoneName: true })',
    ],
    [
      "relative-long",
      'formatRelativeUtc(resetsAt, "en-US", { style: "long" })',
    ],
    [
      "relative-short",
      'formatRelativeUtc(resetsAt, "en-US", { style: "short" })',
    ],
    [
      "relative-narrow",
      'formatRelativeUtc(resetsAt, "en-US", { style: "narrow" })',
    ],
    ["iso-zoned", 'convertUtcToZoned(resetsAt, "America/New_York")'],
    [
      "utc",
      'formatUtc(resetsAt, "en-US", { timeZone: "UTC", includeTimeZoneName: true })',
    ],
    ["http", "formatHttpDate(resetsAt)"],
    ["unix-ms", "convertUtcToUnix(resetsAt)"],
    ["unix-s", 'convertUtcToUnix(resetsAt, { epochUnit: "seconds" })'],
  ];

  it.each(CALLS)("%s shows %s", (id, call) => {
    expect(findResetFormat(id).call(NEW_YORK)).toBe(call);
  });

  // Each page answered 200 at https://northguild.dev/gmt/reference/<path>/ on 2026-11-09.
  it.each([
    ["calendar", "utc/format/formatCalendarUtc"],
    ["local", "utc/format/formatUtc"],
    ["utc", "utc/format/formatUtc"],
    ["relative-short", "utc/format/formatRelativeUtc"],
    ["iso-zoned", "utc/convert/convertUtcToZoned"],
    ["http", "utc/format/formatHttpDate"],
    ["unix-s", "utc/convert/convertUtcToUnix"],
  ])("%s links to gmt's reference page for its function", (id, path) => {
    expect(findResetFormat(id).referenceUrl).toBe(
      `https://northguild.dev/gmt/reference/${path}/`,
    );
  });

  it("names the function each call is of", () => {
    for (const preset of RESET_FORMATS) {
      expect(preset.call(NEW_YORK), preset.id).toContain(`${preset.fnName}(`);
    }
  });
});

describe("choosing a preset", () => {
  it("lists ten presets with unique ids, the calendar one first and the default", () => {
    const ids = RESET_FORMATS.map((p) => p.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids[0]).toBe("calendar");
    expect(DEFAULT_RESET_FORMAT_ID).toBe("calendar");
  });

  it("falls back to the default preset for an id it does not know", () => {
    expect(findResetFormat("nope").id).toBe("calendar");
  });

  it("recognises only real ids", () => {
    expect(isResetFormatId("http")).toBe(true);
    expect(isResetFormatId("nope")).toBe(false);
    expect(isResetFormatId(null)).toBe(false);
  });

  it("swaps every relative preset for the calendar one in a clock, since now-to-now would always say 'now'", () => {
    for (const id of ["relative-long", "relative-short", "relative-narrow"]) {
      expect(liveClockFormat(id).id).toBe("calendar");
    }
  });

  it("keeps every other preset as picked in a clock", () => {
    for (const preset of RESET_FORMATS.filter(
      (p) => !p.id.startsWith("relative"),
    )) {
      expect(liveClockFormat(preset.id).id).toBe(preset.id);
    }
  });
});
