#!/usr/bin/env node
/**
 * Live checks for the docs site after `wrangler deploy` (docs/wrangler.jsonc): the home page, the slash-less
 * redirect, the schema file, the sitemap and a 404, on https://northguild.dev/worktree/, and the headers docs/deploy/_headers
 * sets: the exact Cache-Control of a hashed asset, `X-Robots-Tag: noindex` on llms.txt, and on a page neither noindex nor
 * an immutable Cache-Control. Modelled on
 * northguild/gmt apps/dox/scripts/deploy-smoke.mjs. Run by .github/workflows/docs-deploy.yml; by hand with
 *
 *     pnpm --filter docs deploy:smoke
 *
 * Node 22+, no dependencies. SMOKE_ORIGIN overrides the origin (default https://northguild.dev).
 *
 * Redirects are never followed by the client: each hop is a step in the row's chain. The whole set is retried
 * up to 6 times, 10 s apart, for route propagation. Exits 1 with a table of failures when the last attempt
 * still fails. It does not roll back.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ORIGIN = process.env.SMOKE_ORIGIN ?? "https://northguild.dev";
const BASE = `${ORIGIN}/worktree`;
// Sitemap entries are absolute canonical URLs whatever origin the check is pointed at.
const CANONICAL = "https://northguild.dev/worktree/";
const ATTEMPTS = 6;
const WAIT_MS = 10_000;
// The file `docs:build` copies from docs/public: what the live URL must serve byte for byte.
const SCHEMA_SOURCE = fileURLToPath(
  new URL("../dist/schema/v1.json", import.meta.url),
);

// The year-long value docs/deploy/_headers gives `_astro/*` (D5 of plan 287). Compared whole, not as a substring, so a
// Cache-Control that Cloudflare joined to its own default shows as a different string and fails (D7).
const IMMUTABLE = "public, max-age=31536000, immutable";
// A hashed asset the build emitted, read from dist/ as the schema row reads it: the live site must serve this very name.
const ASSETS_SOURCE = fileURLToPath(new URL("../dist/_astro", import.meta.url));

/** One request, no redirect following. */
async function send(url) {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "worktree-docs-deploy-smoke" },
    signal: AbortSignal.timeout(20_000),
  });
  return {
    status: res.status,
    location: res.headers.get("location")
      ? new URL(res.headers.get("location"), url).href
      : undefined,
    type: res.headers.get("content-type") ?? "",
    headers: res.headers,
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}

/**
 * Run one row: send the request, then check each expected step in turn. A step with `location` is a redirect:
 * the next request goes there. A step with `optional` is skipped when the status differs.
 * `check(response)` may return a failure message.
 */
async function run(row) {
  let url = row.url;
  let response;
  for (let i = 0; i < row.steps.length; i += 1) {
    const step = row.steps[i];
    response ??= await send(url);
    if (step.optional && response.status !== step.status) continue;
    if (response.status !== step.status)
      return `step ${i + 1}: expected ${step.status}, got ${response.status} from ${url}`;
    if (step.type && !response.type.includes(step.type))
      return `step ${i + 1}: expected content-type ${step.type}, got ${response.type}`;
    if (step.location && response.location !== step.location)
      return `step ${i + 1}: expected Location ${step.location}, got ${response.location}`;
    const problem = step.check?.(response);
    if (problem) return `step ${i + 1}: ${problem}`;
    if (step.location) {
      url = response.location;
      response = undefined;
    }
  }
  return undefined;
}

async function buildRows() {
  const schema = await readFile(SCHEMA_SOURCE);
  // Any file in _astro/ will do: all of them are hashed (audit-dist.mjs), and all are covered by the one rule.
  const [asset] = (await readdir(ASSETS_SOURCE)).sort();
  return [
    {
      label: "home page",
      url: `${BASE}/`,
      steps: [{ status: 200, type: "text/html" }],
    },
    {
      label: "home page without the slash",
      url: BASE,
      steps: [{ status: 307, location: `${BASE}/` }, { status: 200 }],
    },
    {
      label: "a page",
      url: `${BASE}/commands/branch/`,
      steps: [{ status: 200, type: "text/html" }],
    },
    {
      label: "schema",
      url: `${BASE}/schema/v1.json`,
      steps: [
        {
          status: 200,
          type: "json",
          check: ({ bytes }) =>
            bytes.equals(schema)
              ? undefined
              : "bytes differ from docs/dist/schema/v1.json",
        },
      ],
    },
    {
      label: "sitemap",
      url: `${BASE}/sitemap-index.xml`,
      steps: [
        {
          status: 200,
          check: ({ bytes }) => {
            const locs = [
              ...bytes.toString("utf8").matchAll(/<loc>([^<]+)<\/loc>/g),
            ].map((m) => m[1]);
            if (locs.length === 0) return "no <loc> entries";
            const bad = locs.filter((l) => !l.startsWith(CANONICAL));
            return bad.length
              ? `<loc> outside ${CANONICAL}: ${bad[0]}`
              : undefined;
          },
        },
      ],
    },
    {
      label: "hashed asset caches for a year",
      url: `${BASE}/_astro/${asset}`,
      steps: [
        {
          status: 200,
          check: ({ headers }) =>
            headers.get("cache-control") === IMMUTABLE
              ? undefined
              : `expected Cache-Control ${IMMUTABLE}, got ${headers.get("cache-control")}`,
        },
      ],
    },
    {
      label: "llms.txt is noindex",
      url: `${BASE}/llms.txt`,
      steps: [
        {
          status: 200,
          check: ({ headers }) =>
            headers.get("x-robots-tag") === "noindex"
              ? undefined
              : `expected X-Robots-Tag noindex, got ${headers.get("x-robots-tag")}`,
        },
      ],
    },
    {
      label: "a page is not noindex or immutable",
      url: `${BASE}/commands/branch/`,
      steps: [
        {
          status: 200,
          // A page changes without changing its URL, so it must keep revalidating (D5).
          check: ({ headers }) =>
            headers.has("x-robots-tag")
              ? `expected no X-Robots-Tag, got ${headers.get("x-robots-tag")}`
              : /immutable/i.test(headers.get("cache-control") ?? "")
                ? `expected a page to revalidate, got Cache-Control ${headers.get("cache-control")}`
                : undefined,
        },
      ],
    },
    {
      label: "404",
      url: `${BASE}/nope/`,
      steps: [{ status: 404, type: "text/html" }],
    },
    {
      label: "404 without the slash",
      url: `${BASE}/nope`,
      steps: [
        { status: 307, location: `${BASE}/nope/`, optional: true },
        { status: 404, type: "text/html" },
      ],
    },
  ];
}

async function attempt() {
  const failures = [];
  for (const row of await buildRows()) {
    let problem;
    try {
      problem = await run(row);
    } catch (error) {
      problem = `request failed: ${error.message}`;
    }
    if (problem) failures.push({ row: row.label, url: row.url, problem });
  }
  return failures;
}

let failures = [];
for (let i = 1; i <= ATTEMPTS; i += 1) {
  failures = await attempt();
  if (failures.length === 0) {
    console.log(`deploy-smoke: every row passed (attempt ${i}).`);
    process.exit(0);
  }
  console.log(
    `deploy-smoke: attempt ${i}/${ATTEMPTS} failed ${failures.length} row(s).`,
  );
  if (i < ATTEMPTS) await new Promise((r) => setTimeout(r, WAIT_MS));
}
console.error("\ndeploy-smoke: failures after the last attempt\n");
console.table(failures);
process.exit(1);
