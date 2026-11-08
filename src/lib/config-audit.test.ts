import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #281 D9, §4: `gitGetConfigValue` reads git config only. Every place that
// still calls it is on the list below with the reason it is allowed to; any
// other reader of a setting goes through `getConfigValue` / `getTeamConfigValue`
// so the user file can answer. A new raw call that is on no list fails here.

const SRC = fileURLToPath(new URL("..", import.meta.url));
const RAW = "gitGetConfigValue";

type Kind = "git-only" | "deferred";

interface Site {
  /** The first argument as written, or `(value)` where the function is passed on. */
  key: string;
  kind: Kind;
  reason: string;
}

const SECRET = "a secret is never read from a file (D9)";
const PROBE = "a probe of whether the key is set in git config itself (D9)";

// One entry per call site, in file order. A file's keys are compared as an
// ordered list, so a second call with a key already listed fails too, and so
// does reordering the calls within a file.
const SITES: Record<string, Site[]> = {
  "commands/branch.ts": [
    { key: '"linear.apiKey"', kind: "git-only", reason: SECRET },
    { key: '"clickup.apiToken"', kind: "git-only", reason: SECRET },
  ],
  "commands/config.ts": [
    {
      key: "variable",
      kind: "git-only",
      reason:
        "`--list` shows git config's own value so it can say what it overrides (D11)",
    },
  ],
  "commands/linear-listen.ts": [
    { key: '"linear.agentToken"', kind: "git-only", reason: SECRET },
    { key: '"linear.webhookSecret"', kind: "git-only", reason: SECRET },
    { key: '"linear.apiKey"', kind: "git-only", reason: SECRET },
  ],
  "integrations/clickup.ts": [
    { key: '"clickup.apiToken"', kind: "git-only", reason: SECRET },
  ],
  "integrations/github.ts": [
    { key: '"github.token"', kind: "git-only", reason: SECRET },
    { key: '"github.token"', kind: "git-only", reason: SECRET },
  ],
  "integrations/jira.ts": [
    { key: '"jira.apiToken"', kind: "git-only", reason: SECRET },
  ],
  "integrations/linear.ts": [
    { key: '"linear.apiKey"', kind: "git-only", reason: SECRET },
  ],
  "lib/base-command.ts": [
    {
      key: '"has-called-config"',
      kind: "git-only",
      reason: "whether this machine ran `config` is not a setting (D9)",
    },
  ],
  "lib/config-wizard/trackers.ts": [
    { key: '"jira.apiToken"', kind: "git-only", reason: SECRET },
    { key: '"jira.autoAssign"', kind: "git-only", reason: PROBE },
    { key: '"jira.autoStart"', kind: "git-only", reason: PROBE },
    { key: '"github.token"', kind: "git-only", reason: SECRET },
    { key: '"github.autoAssign"', kind: "git-only", reason: PROBE },
    { key: '"linear.apiKey"', kind: "git-only", reason: SECRET },
    { key: '"linear.autoStart"', kind: "git-only", reason: PROBE },
    { key: '"clickup.apiToken"', kind: "git-only", reason: SECRET },
    { key: '"clickup.autoAssign"', kind: "git-only", reason: PROBE },
    { key: '"clickup.autoStart"', kind: "git-only", reason: PROBE },
  ],
  "lib/config-wizard/written.ts": [
    {
      key: "name",
      kind: "git-only",
      reason: "the before-value of a write is what git config held",
    },
  ],
  "lib/config.ts": [
    {
      key: "name",
      kind: "git-only",
      reason: "the layered reader's own secret branch",
    },
    {
      key: "name",
      kind: "git-only",
      reason: "the layered reader's own first layer",
    },
  ],
  "lib/git.ts": [
    {
      key: '"defaultSourceBranch"',
      kind: "git-only",
      reason:
        "the personal key only, so a project file cannot change what counts as unpushed work",
    },
  ],
  "lib/install.ts": [
    {
      key: '"postCreate"',
      kind: "git-only",
      reason:
        "the first layer of postCreate; the file layers have list readers",
    },
  ],
  "lib/issue-link.ts": [
    { key: '"linear.apiKey"', kind: "git-only", reason: SECRET },
  ],
  "lib/project-config.ts": [
    {
      key: '"defaultSourceBranch"',
      kind: "git-only",
      reason:
        "the ref the project file is read from; its own value is circular",
    },
    {
      key: "name",
      kind: "git-only",
      reason: "resolveTeamConfig's own first layer",
    },
    {
      key: '"postCreate"',
      kind: "git-only",
      reason: "a personal postCreate skips the approval; it is the first layer",
    },
    {
      key: "key",
      kind: "git-only",
      reason: "`writeProjectFile` copies the team keys held in git config",
    },
    {
      key: "key",
      kind: "git-only",
      reason: "the offer asks whether git config holds a team key",
    },
  ],
};

/** Source with comments and import statements blanked, positions kept. */
function codeOf(source: string) {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (_m, lead: string) => lead)
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, blank)
    .replace(/^export\s+(?:async\s+)?function\s+gitGetConfigValue\b/gm, blank);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts") &&
      full !== path.join(SRC, "test-setup.ts")
      ? [full]
      : [];
  });
}

/** Each mention of the raw reader outside imports and comments, with its key. */
function mentions(code: string) {
  const found: string[] = [];
  for (const match of code.matchAll(new RegExp(`\\b${RAW}\\b`, "g"))) {
    const after = code.slice(match.index + RAW.length);
    const call = /^\s*\(\s*([^,)]*?)\s*[,)]/.exec(after);
    found.push(call ? call[1] : "(value)");
  }
  return found;
}

const files = sourceFiles(SRC).map((file) => ({
  name: path.relative(SRC, file).split(path.sep).join("/"),
  raw: fs.readFileSync(file, "utf8"),
}));

describe("the raw git config reader (#281 D9)", () => {
  it("is called only from the listed sites", () => {
    const actual: Record<string, string[]> = {};
    for (const { name, raw } of files) {
      const keys = mentions(codeOf(raw));
      if (keys.length > 0) {
        actual[name] = keys;
      }
    }
    const expected = Object.fromEntries(
      Object.entries(SITES).map(([name, sites]) => [
        name,
        sites.map((site) => site.key),
      ]),
    );
    expect(actual).toEqual(expected);
  });

  it("is not imported under another name", () => {
    const aliased = files
      .filter(({ raw }) => new RegExp(`${RAW}\\s+as\\s`).test(raw))
      .map(({ name }) => name);
    expect(aliased).toEqual([]);
  });

  it("gives every listed site a reason", () => {
    for (const [name, sites] of Object.entries(SITES)) {
      for (const site of sites) {
        expect(site.reason, `${name} ${site.key}`).not.toBe("");
      }
    }
  });

  it("is the only reader that runs `git config northguild.worktree.*` for a key name", () => {
    // A new file that spells the namespace out is a second raw reader.
    const readers = files
      .filter(({ raw }) => /`northguild\.worktree\.\$\{/.test(codeOf(raw)))
      .map(({ name }) => name);
    expect(readers.sort()).toEqual(["lib/config.ts", "lib/project-config.ts"]);
  });
});
