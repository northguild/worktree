#!/usr/bin/env node
/**
 * Core Web Vitals for three pages of the docs site, by hand. Not a gate: no CI job runs it and it writes no
 * numbers into the tree (plan #287, D11) — the output goes in a comment on the issue.
 *
 * Pages: the landing, one guide and one command page (the largest). Each is measured three ways:
 *
 * - Lighthouse, mobile and desktop presets, `--runs` runs each (default 3): the median LCP, CLS and TBT.
 *   TBT is Lighthouse's lab stand-in for INP.
 * - INP, in Playwright Chromium with 4x CPU throttling: the page loads and settles, then does what a reader
 *   does — opens search with Ctrl+K and types, toggles the theme, opens and closes the mobile menu at 390x844.
 *   Each interaction is reported with its own worst duration; the page's INP is the worst of them (with fewer
 *   than 50 interactions the INP is the longest one, web.dev/articles/inp).
 * - The PageSpeed Insights API, read-only, for the same pages on a live origin: lab numbers and the CrUX field
 *   data for the URL and for the origin, or "no field data" when there is none.
 *
 * Thresholds ("good" at the 75th percentile, web.dev/articles/vitals): LCP <= 2.5 s, CLS <= 0.1,
 * INP <= 200 ms. TBT <= 200 ms is Lighthouse's own mark.
 *
 * Usage, from `docs/`, against a served build whose pages answer under `/worktree/` (the `docs/.deploy`
 * directory served by `wrangler dev --local`, or `astro preview`) and/or the live origin:
 *
 *     node scripts/web-vitals.mjs --origin http://127.0.0.1:4500 [--live https://northguild.dev]
 *         [--runs 3] [--skip lighthouse,inp,psi]
 *
 * The PSI call needs no key at a low request rate; set `PSI_API_KEY` in the environment for a higher quota and
 * never write it into a file. Lighthouse runs through `npx` at the pinned version below and uses the Chromium
 * that Playwright installed (`pnpm --filter docs exec playwright install chromium`).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

/** Pinned: a range would let the numbers move between runs of this script. */
const LIGHTHOUSE = "lighthouse@13.6.0";

const PAGES = [
  { name: "landing", path: "/worktree/" },
  { name: "guide", path: "/worktree/guides/github-issue-integration/" },
  { name: "command", path: "/worktree/commands/branch/" },
];

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    live: { type: "string" },
    runs: { type: "string", default: "3" },
    skip: { type: "string", default: "" },
  },
});
const skip = new Set(values.skip.split(",").filter(Boolean));
const runs = Number(values.runs);
if (!values.origin && !values.live) {
  console.error("Pass --origin <served build> and/or --live <origin>.");
  process.exit(1);
}
if (!Number.isInteger(runs) || runs < 1) {
  console.error("--runs must be a positive integer.");
  process.exit(1);
}

function median(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function fmt(n, unit = "") {
  return n === undefined || Number.isNaN(n)
    ? "-"
    : `${Math.round(n * 1000) / 1000}${unit}`;
}

/** One Lighthouse run's LCP (ms), CLS and TBT (ms). */
function lighthouseRun(url, preset) {
  const dir = mkdtempSync(join(tmpdir(), "lh-"));
  const out = join(dir, "r.json");
  const args = [
    "--yes",
    LIGHTHOUSE,
    url,
    "--output=json",
    `--output-path=${out}`,
    "--quiet",
    "--only-categories=performance",
    "--chrome-flags=--headless=new --no-sandbox",
    ...(preset === "desktop" ? ["--preset=desktop"] : []),
  ];
  const result = spawnSync("npx", args, {
    encoding: "utf8",
    env: { ...process.env, CHROME_PATH: chromium.executablePath() },
  });
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`lighthouse failed: ${result.stderr}`);
  }
  const audits = JSON.parse(readFileSync(out, "utf8")).audits;
  rmSync(dir, { recursive: true, force: true });
  return {
    lcp: audits["largest-contentful-paint"].numericValue,
    cls: audits["cumulative-layout-shift"].numericValue,
    tbt: audits["total-blocking-time"].numericValue,
  };
}

/**
 * The worst duration of each interaction a reader makes on one page under 4x CPU throttling. A step with no
 * value took less than 16 ms, the Event Timing floor.
 */
async function interactionsOf(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(url, { waitUntil: "load" });
  // A reader's first click comes after the load; an interaction made while the page is still starting would
  // measure the start, not the page.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.__step = "";
    window.__worst = {};
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.interactionId) continue;
        const was = window.__worst[window.__step] ?? 0;
        window.__worst[window.__step] = Math.max(was, e.duration);
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  });
  const step = (name) => page.evaluate((n) => (window.__step = n), name);
  const pause = () => page.waitForTimeout(500);

  await step("search");
  await page.keyboard.press("Control+k");
  await pause();
  await page.keyboard.type("branch", { delay: 60 });
  await pause();
  await page.keyboard.press("Escape");
  await pause();

  await step("theme toggle");
  await page.locator("button.theme-toggle:visible").first().click();
  await pause();

  // Starlight's menu button shows below its 50rem breakpoint.
  await page.setViewportSize({ width: 390, height: 844 });
  await step("mobile menu");
  const menu = page.locator("button.sl-menu-button");
  // A page with no sidebar (the landing) has no menu button; its step reports "none".
  const hasMenu = (await menu.count()) > 0;
  if (hasMenu) {
    await menu.click();
    await pause();
    await menu.click();
    await pause();
  }

  // INP is reported once the entries are delivered; give them time to.
  await page.waitForTimeout(1000);
  const worst = await page.evaluate(() => window.__worst);
  await context.close();
  return { worst, hasMenu };
}

/** PageSpeed Insights for one URL and strategy: lab numbers and CrUX field data (or none). */
async function psi(url, strategy) {
  const key = process.env.PSI_API_KEY ? `&key=${process.env.PSI_API_KEY}` : "";
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance${key}`;
  const res = await fetch(api);
  if (!res.ok) {
    // The body can echo the request URL, which carries the key: print the status and the message only.
    const message = await res
      .json()
      .then((b) => b.error?.message)
      .catch(() => undefined);
    throw new Error(
      `PSI ${res.status} for ${url}: ${message ?? res.statusText}`,
    );
  }
  const body = await res.json();
  const a = body.lighthouseResult.audits;
  return {
    lcp: a["largest-contentful-paint"].numericValue,
    cls: a["cumulative-layout-shift"].numericValue,
    tbt: a["total-blocking-time"].numericValue,
    url: fieldOf(body.loadingExperience?.metrics),
    origin: fieldOf(body.originLoadingExperience?.metrics),
  };
}

/** The 75th-percentile field values, or undefined when CrUX has none. CLS comes back multiplied by 100. */
function fieldOf(metrics) {
  if (!metrics) return undefined;
  return {
    lcp: metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile,
    cls: metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile / 100,
    inp: metrics.INTERACTION_TO_NEXT_PAINT?.percentile,
  };
}

const rows = [];
function row(...cells) {
  rows.push(cells);
  // A run takes minutes: show each row as it lands, in case a later step fails.
  console.error(cells.join(" | "));
}
row("source", "page", "LCP", "CLS", "TBT or INP");

if (values.origin && !skip.has("lighthouse")) {
  for (const preset of ["mobile", "desktop"]) {
    for (const p of PAGES) {
      const rs = Array.from({ length: runs }, () =>
        lighthouseRun(values.origin + p.path, preset),
      );
      row(
        `lab ${preset} (median of ${runs})`,
        p.name,
        fmt(median(rs.map((r) => r.lcp)), " ms"),
        fmt(median(rs.map((r) => r.cls))),
        `TBT ${fmt(median(rs.map((r) => r.tbt)), " ms")}`,
      );
    }
  }
}
if (values.origin && !skip.has("inp")) {
  const browser = await chromium.launch();
  for (const p of PAGES) {
    const { worst, hasMenu } = await interactionsOf(
      browser,
      values.origin + p.path,
    );
    for (const name of ["search", "theme toggle", "mobile menu"]) {
      row(
        "INP 4x CPU",
        p.name,
        "-",
        "-",
        name === "mobile menu" && !hasMenu
          ? `${name}: no menu button on this page`
          : worst[name] === undefined
            ? `${name}: none >= 16 ms`
            : `${name}: ${fmt(worst[name], " ms")}`,
      );
    }
    row(
      "INP 4x CPU",
      p.name,
      "-",
      "-",
      `INP (worst) ${fmt(Math.max(0, ...Object.values(worst)), " ms")}`,
    );
  }
  await browser.close();
}
if (values.live && !skip.has("psi")) {
  for (const strategy of ["mobile", "desktop"]) {
    for (const p of PAGES) {
      const r = await psi(values.live + p.path, strategy).catch((error) => {
        // A refused call (the keyless quota is shared and often spent) must not hide the other rows.
        row(
          `PSI ${strategy}`,
          p.name,
          "-",
          "-",
          `unavailable: ${error.message}`,
        );
      });
      if (!r) continue;
      row(
        `PSI ${strategy}`,
        p.name,
        fmt(r.lcp, " ms"),
        fmt(r.cls),
        `TBT ${fmt(r.tbt, " ms")}`,
      );
      for (const [label, field] of [
        ["CrUX url", r.url],
        ["CrUX origin", r.origin],
      ]) {
        row(
          `${label} ${strategy}`,
          p.name,
          field ? fmt(field.lcp, " ms") : "no field data",
          field ? fmt(field.cls) : "-",
          field ? `INP ${fmt(field.inp, " ms")}` : "-",
        );
      }
    }
  }
}

const widths = rows[0].map((_, i) =>
  Math.max(...rows.map((r) => String(r[i]).length)),
);
for (const r of rows) {
  console.log(r.map((c, i) => String(c).padEnd(widths[i])).join("  "));
}
