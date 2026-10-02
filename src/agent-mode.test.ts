// End-to-end agent-mode cases (#70, D15): the compiled CLI runs as a child
// process with no TTY, against a throwaway repository, and each case asserts
// the exit code and the one JSON document on stdout.
//
// Nothing here touches the machine it runs on. The CLI is compiled from `src`
// into a temp directory (the repo's `dist/` can be stale, and `publish.yml`
// runs test before build). GitHub is a `fetch` replaced through an `--import`
// preload; `herdr`, `claude`, `gh` and `pnpm` are fake executables placed first
// on PATH; origin is `git@github.com:acme/demo.git` served from a local bare
// repository through `GIT_SSH_COMMAND`. The child's environment is built from
// scratch, so no token, config or editor of the developer's reaches it.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const COMPILE_TIMEOUT_MS = 120_000; // R5: the temp compile is the fragile step.
const CASE_TIMEOUT_MS = 20_000;
// A case spawns a few git processes and the CLI, so the test's own bound sits
// above the child's.
const TEST_TIMEOUT_MS = CASE_TIMEOUT_MS + 10_000;

// A placeholder, not a credential: the stubbed GitHub accepts anything, and the
// shape deliberately matches no secret scanner's pattern.
const FAKE_GITHUB_TOKEN = "test-token-not-a-credential";

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface Scenario {
  /** The repository the CLI runs in. */
  repo: string;
  /** Every request the stubbed GitHub received, as `METHOD /path`. */
  githubRequests: () => string[];
  /** Every `herdr` invocation, as its argument line. */
  herdrCalls: () => string[];
  /** Every `pnpm` invocation, as `<cwd> <arguments>`. */
  installCalls: () => string[];
  run: (args: string[]) => Promise<CliResult>;
  /** Where a worktree for `branch` lands. */
  worktreePath: (branch: string) => string;
}

let workDir: string;
let packageDir: string;
let fakeBinDir: string;
let preloadPath: string;
let sshPath: string;
let basePath: string;
let scenarioCount = 0;

function writeExecutable(file: string, body: string) {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** The whole of stdout as one JSON document: throws on anything else. */
function parseDocument(stdout: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed)) {
    throw new Error(`stdout is not a JSON object: ${stdout}`);
  }
  return parsed;
}

async function git(cwd: string, ...args: string[]) {
  await execFileAsync("git", args, {
    cwd,
    env: { ...gitEnv(), PATH: basePath },
  });
}

// No user or system git config: signing, hooks, includeIf and aliases of the
// machine the suite runs on stay out of the fixtures.
function gitEnv(): Record<string, string> {
  return {
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function spawnCli(
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", preloadPath, path.join(packageDir, "bin/run.js"), ...args],
      { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `worktree ${args.join(" ")} did not finish in ${CASE_TIMEOUT_MS}ms\nstdout: ${stdout}\nstderr: ${stderr}`,
        ),
      );
    }, CASE_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

/**
 * A fresh repository, bare origin and environment. Each case gets its own so
 * none depends on what another left behind.
 */
async function createScenario(
  extraEnv: Record<string, string> = {},
  config: Record<string, string> = {},
  checkoutName = "checkout",
): Promise<Scenario> {
  scenarioCount += 1;
  const dir = path.join(workDir, `case-${scenarioCount}`);
  const bare = path.join(dir, "origin.git");
  const seed = path.join(dir, "seed");
  // Any name works, including a branch's: a worktree is removed by its path, so
  // a checkout named like a branch under test is not ambiguous (#77).
  const repo = path.join(dir, checkoutName);
  const home = path.join(dir, "home");
  const githubLog = path.join(dir, "github.log");
  const herdrLog = path.join(dir, "herdr.log");
  const installLog = path.join(dir, "install.log");
  fs.mkdirSync(home, { recursive: true });

  await git(dir, "init", "--bare", "-b", "main", bare);
  await git(dir, "init", "-b", "main", seed);
  // A lockfile in the tree is what the install step infers its command from.
  fs.writeFileSync(
    path.join(seed, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n",
  );
  fs.writeFileSync(path.join(seed, "README.md"), "# demo\n");
  await git(seed, "add", ".");
  await git(
    seed,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "seed",
  );
  await git(seed, "push", bare, "main");
  await git(dir, "clone", bare, repo);
  await git(
    repo,
    "remote",
    "set-url",
    "origin",
    "git@github.com:acme/demo.git",
  );

  const settings: Record<string, string> = {
    "has-called-config": "true",
    defaultSourceBranch: "origin/main",
    // Never the editor: a case that forgot to say would otherwise launch one.
    opener: "none",
    "github.token": FAKE_GITHUB_TOKEN,
    ...config,
  };
  for (const [key, value] of Object.entries(settings)) {
    await git(repo, "config", `northguild.worktree.${key}`, value);
  }

  const env: Record<string, string> = {
    ...gitEnv(),
    PATH: `${fakeBinDir}:${basePath}`,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_DATA_HOME: path.join(home, "data"),
    FORCE_COLOR: "0",
    GIT_SSH_COMMAND: sshPath,
    WORKTREE_SKIP_NEW_VERSION_CHECK: "true",
    WT_BARE: bare,
    WT_GITHUB_LOG: githubLog,
    WT_HERDR_LOG: herdrLog,
    WT_INSTALL_LOG: installLog,
    ...extraEnv,
  };

  return {
    repo,
    githubRequests: () => readLines(githubLog),
    herdrCalls: () => readLines(herdrLog),
    installCalls: () => readLines(installLog),
    run: (args) => spawnCli(args, repo, env),
    worktreePath: (branch) => path.join(`${repo}.worktrees`, branch),
  };
}

// Replaces `fetch` in the child. Only the three calls `branch --github` makes
// are answered; anything else throws, so a call that would have left the
// machine fails the case instead.
const PRELOAD_SOURCE = `
import { appendFileSync } from "node:fs";

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  appendFileSync(process.env.WT_GITHUB_LOG, method + " " + url.pathname + "\\n");
  const reply = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  if (url.host !== "api.github.com") {
    throw new Error("unexpected host in the test stub: " + url.host);
  }
  if (method === "GET" && url.pathname === "/user") {
    return reply(200, { login: "octocat" });
  }
  if (method === "GET" && url.pathname === "/repos/acme/demo/issues/7") {
    return reply(200, {
      number: 7,
      title: "Add agent mode to the CLI",
      body: null,
      state: "open",
      html_url: "https://github.com/acme/demo/issues/7",
      type: null,
      user: { login: "octocat", html_url: "https://github.com/octocat" },
      assignees: [],
    });
  }
  if (method === "POST" && url.pathname === "/repos/acme/demo/issues/7/assignees") {
    return reply(201, { number: 7, assignees: [{ login: "octocat" }] });
  }
  throw new Error("unexpected request in the test stub: " + method + " " + url.pathname);
};
`;

function installFixtures() {
  fakeBinDir = path.join(workDir, "fake-bin");
  fs.mkdirSync(fakeBinDir);

  // Each stands in for a program the CLI may reach for, so the real one is
  // never found: the fake directory is first on PATH.
  writeExecutable(
    path.join(fakeBinDir, "herdr"),
    `echo "$*" >> "$WT_HERDR_LOG"
if [ "$1 $2" = "agent list" ] && [ -n "$WT_HERDR_AGENTS" ]; then
  cat "$WT_HERDR_AGENTS"
  exit 0
fi
echo '{"error":{"code":"unavailable","message":"fake herdr"}}' >&2
exit 1`,
  );
  writeExecutable(
    path.join(fakeBinDir, "claude"),
    `if [ "$1 $2" = "agents --json" ] && [ -n "$WT_CLAUDE_AGENTS" ]; then
  cat "$WT_CLAUDE_AGENTS"
  exit 0
fi
exit 1`,
  );
  writeExecutable(path.join(fakeBinDir, "gh"), "exit 1");
  writeExecutable(
    path.join(fakeBinDir, "pnpm"),
    `echo "$PWD $*" >> "$WT_INSTALL_LOG"`,
  );

  // `git@github.com:acme/demo.git` is fetched by ssh-ing `git-upload-pack`;
  // this answers that from the local bare repository instead.
  sshPath = path.join(workDir, "fake-ssh");
  writeExecutable(
    sshPath,
    `case "$2" in
  git-upload-pack*) exec git upload-pack "$WT_BARE" ;;
  git-receive-pack*) exec git receive-pack "$WT_BARE" ;;
esac
echo "fake ssh: unsupported command: $2" >&2
exit 1`,
  );

  preloadPath = path.join(workDir, "github-stub.mjs");
  fs.writeFileSync(preloadPath, PRELOAD_SOURCE);
}

async function compileCli() {
  packageDir = path.join(workDir, "package");
  fs.mkdirSync(path.join(packageDir, "bin"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, "package.json"),
    path.join(packageDir, "package.json"),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, "bin/run.js"),
    path.join(packageDir, "bin/run.js"),
  );
  // Dependencies and oclif's `@oclif/plugin-*` glob resolve through this link.
  fs.symlinkSync(
    path.join(REPO_ROOT, "node_modules"),
    path.join(packageDir, "node_modules"),
  );
  await execFileAsync(
    process.execPath,
    [
      path.join(REPO_ROOT, "node_modules/typescript/bin/tsc"),
      "-p",
      "tsconfig.build.json",
      "--outDir",
      path.join(packageDir, "dist"),
    ],
    { cwd: REPO_ROOT },
  );
}

beforeAll(async () => {
  workDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "worktree-agent-mode-")),
  );
  // Only what the CLI needs: node, git and the coreutils behind `which`.
  const { stdout: gitPath } = await execFileAsync("which", ["git"]);
  basePath = [
    ...new Set([
      path.dirname(process.execPath),
      path.dirname(gitPath.trim()),
      "/usr/bin",
      "/bin",
    ]),
  ].join(":");
  installFixtures();
  await compileCli();
}, COMPILE_TIMEOUT_MS);

afterAll(() => {
  if (workDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

describe("agent mode, spawned", () => {
  it(
    "branch --github 7 --json prints one document for the issue's branch",
    async () => {
      const scenario = await createScenario();

      const result = await scenario.run(["branch", "--github", "7", "--json"]);

      expect(result.exitCode).toBe(0);
      const document = parseDocument(result.stdout);
      expect(document).toMatchObject({
        path: scenario.worktreePath("7-add-agent-mode-to-the-cli"),
        branch: "7-add-agent-mode-to-the-cli",
        source: "origin/main",
        issue: {
          provider: "github",
          number: 7,
          url: "https://github.com/acme/demo/issues/7",
        },
      });
      expect(
        fs.existsSync(scenario.worktreePath("7-add-agent-mode-to-the-cli")),
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "branch demo --no-open --json starts no Herdr space and no agent",
    async () => {
      // Herdr is the configured opener, so only --no-open keeps it from being used.
      const scenario = await createScenario({}, { opener: "herdr" });

      const result = await scenario.run([
        "branch",
        "demo",
        "--no-open",
        "--json",
      ]);

      expect(result.exitCode).toBe(0);
      expect(parseDocument(result.stdout)).toMatchObject({
        branch: "demo",
        herdr: null,
        agent: null,
      });
      expect(scenario.herdrCalls()).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "remove demo -f --json names what it removed",
    async () => {
      const scenario = await createScenario();
      const created = await scenario.run(["branch", "demo", "--json"]);
      expect(created.exitCode).toBe(0);

      const result = await scenario.run(["remove", "demo", "-f", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(parseDocument(result.stdout)).toMatchObject({
        removed: [{ branch: "demo", path: scenario.worktreePath("demo") }],
      });
      expect(fs.existsSync(scenario.worktreePath("demo"))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "remove demo -f --json works when the main checkout directory is also named demo",
    async () => {
      // Git matches a bare name against the trailing components of every
      // worktree, so the checkout and `demo.worktrees/demo` both answered to it.
      const scenario = await createScenario({}, {}, "demo");
      const created = await scenario.run(["branch", "demo", "--json"]);
      expect(created.exitCode).toBe(0);

      const result = await scenario.run(["remove", "demo", "-f", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(parseDocument(result.stdout)).toMatchObject({
        removed: [{ branch: "demo", path: scenario.worktreePath("demo") }],
      });
      expect(fs.existsSync(scenario.worktreePath("demo"))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "remove -f --json removes either of branches demo and x/demo checked out side by side",
    async () => {
      // Both worktree paths end in `demo`, so a bare name matched both.
      const scenario = await createScenario();
      for (const branch of ["demo", "x/demo"]) {
        const created = await scenario.run(["branch", branch, "--json"]);
        expect(created.exitCode).toBe(0);
      }

      for (const branch of ["demo", "x/demo"]) {
        const result = await scenario.run(["remove", branch, "-f", "--json"]);

        expect(result.exitCode).toBe(0);
        expect(parseDocument(result.stdout)).toMatchObject({
          removed: [{ branch, path: scenario.worktreePath(branch) }],
        });
        expect(fs.existsSync(scenario.worktreePath(branch))).toBe(false);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list --agents --json names the session found through Herdr and the runtime",
    async () => {
      const agentsDir = path.join(workDir, "list-agents");
      fs.mkdirSync(agentsDir);
      const herdrAgents = path.join(agentsDir, "herdr-agents.json");
      const claudeAgents = path.join(agentsDir, "claude-agents.json");
      const scenario = await createScenario(
        { WT_HERDR_AGENTS: herdrAgents, WT_CLAUDE_AGENTS: claudeAgents },
        { "agent.command": "claude" },
      );
      const created = await scenario.run(["branch", "demo", "--json"]);
      expect(created.exitCode).toBe(0);
      const cwd = scenario.worktreePath("demo");
      // The shapes `claude agents --json` and `herdr agent list` answer with,
      // as the unit tests for both seams already use them.
      fs.writeFileSync(
        claudeAgents,
        JSON.stringify([
          {
            cwd,
            kind: "interactive",
            name: "demo-session",
            pid: 9187,
            sessionId: "s-1",
            startedAt: 1788600791123,
            status: "idle",
          },
        ]),
      );
      fs.writeFileSync(
        herdrAgents,
        JSON.stringify({
          id: "cli:agent:list",
          result: {
            type: "agent_list",
            agents: [
              {
                agent: "claude",
                agent_session: {
                  agent: "claude",
                  kind: "id",
                  source: "herdr:claude",
                  value: "s-1",
                },
                agent_status: "idle",
                cwd,
                pane_id: "wA:p1",
                workspace_id: "wA",
              },
            ],
          },
        }),
      );

      const result = await scenario.run(["list", "--agents", "--json"]);

      expect(result.exitCode).toBe(0);
      const document = parseDocument(result.stdout);
      expect(document).toMatchObject({
        worktrees: expect.arrayContaining([
          expect.objectContaining({
            branch: "demo",
            agent: expect.objectContaining({
              name: "demo-session",
              sessionId: "s-1",
              herdrAgent: "wA:p1",
              live: true,
            }),
          }),
        ]),
      });
    },
    TEST_TIMEOUT_MS,
  );

  describe("the non-interactive defaults for branch --github", () => {
    const assigneePost = "POST /repos/acme/demo/issues/7/assignees";

    it(
      "install and assign both happen with neither flag",
      async () => {
        const scenario = await createScenario();

        const result = await scenario.run([
          "branch",
          "--github",
          "7",
          "--json",
        ]);

        expect(result.exitCode).toBe(0);
        const document = parseDocument(result.stdout);
        expect(document).toMatchObject({
          assigned: true,
          installed: {
            ran: true,
            command: "pnpm install --frozen-lockfile",
            inferred: true,
            ok: true,
          },
        });
        expect(scenario.githubRequests()).toContain(assigneePost);
        expect(scenario.installCalls()).toEqual([
          `${scenario.worktreePath("7-add-agent-mode-to-the-cli")} install --frozen-lockfile`,
        ]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "--no-assign sends no assignee request and still installs",
      async () => {
        const scenario = await createScenario();

        const result = await scenario.run([
          "branch",
          "--github",
          "7",
          "--no-assign",
          "--json",
        ]);

        expect(result.exitCode).toBe(0);
        expect(parseDocument(result.stdout)).toMatchObject({
          assigned: null,
          installed: { ran: true, ok: true },
        });
        expect(scenario.githubRequests()).not.toContain(assigneePost);
        expect(scenario.installCalls()).toHaveLength(1);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "--no-install runs no install and still assigns",
      async () => {
        const scenario = await createScenario();

        const result = await scenario.run([
          "branch",
          "--github",
          "7",
          "--no-install",
          "--json",
        ]);

        expect(result.exitCode).toBe(0);
        expect(parseDocument(result.stdout)).toMatchObject({
          assigned: true,
          installed: { ran: false },
        });
        expect(scenario.githubRequests()).toContain(assigneePost);
        expect(scenario.installCalls()).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );
  });

  it(
    "branch with no name exits 2 with missing_value on stdout and one stderr line",
    async () => {
      const scenario = await createScenario();

      const result = await scenario.run(["branch", "--json"]);

      expect(result.exitCode).toBe(2);
      expect(parseDocument(result.stdout)).toMatchObject({
        error: { code: "missing_value" },
      });
      expect(result.stderr.trimEnd().split("\n")).toEqual([
        expect.stringMatching(/^worktree: no default for /),
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "branch with a brief and no agent to take it exits 2 before creating anything",
    async () => {
      // `opener` none and no `agent.command`: nothing would ever read the brief.
      const scenario = await createScenario();

      const result = await scenario.run([
        "branch",
        "demo",
        "--agent",
        "implement the issue",
        "--json",
      ]);

      expect(result.exitCode).toBe(2);
      expect(parseDocument(result.stdout)).toMatchObject({
        error: {
          code: "missing_value",
          details: { value: "the agent command" },
        },
      });
      expect(fs.existsSync(scenario.worktreePath("demo"))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  // The E2 regression (`columns` 0 under a pty completes) is not repeated here:
  // it is the Phase 2 unit test in src/lib/progress.test.ts.
});
