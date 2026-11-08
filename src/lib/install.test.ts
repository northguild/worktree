import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockRunStreaming } from "../test-setup.js";
import * as cli from "./cli.js";
import * as config from "./config.js";
import { INSTALL_TIMEOUT_MS, runInstall } from "./install.js";
import { setNonInteractive } from "./interaction.js";
import * as projectConfig from "./project-config.js";

let tree: string;
let postCreate: string;
let projectSteps: string[];
let userSteps: string[];

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), "worktree-install-"));
  postCreate = "";
  projectSteps = [];
  userSteps = [];
  vi.spyOn(projectConfig, "getProjectPostCreateSteps").mockImplementation(
    async () => projectSteps,
  );
  // Never the real user file (#281).
  vi.spyOn(projectConfig, "getUserPostCreateSteps").mockImplementation(
    async () => userSteps,
  );
  vi.spyOn(config, "gitGetConfigValue").mockImplementation(async (name) =>
    name === "postCreate" ? postCreate : "",
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Bare `run` here is non-interactive unless a case says otherwise: the
  // default the step is built around.
  setNonInteractive(true);
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function lockfile(name: string) {
  writeFileSync(join(tree, name), "");
}

describe("runInstall inference", () => {
  it.each([
    ["pnpm-lock.yaml", "pnpm", ["install", "--frozen-lockfile"]],
    ["package-lock.json", "npm", ["ci"]],
    ["yarn.lock", "yarn", ["install"]],
    ["bun.lock", "bun", ["install", "--frozen-lockfile"]],
  ])("infers from %s", async (file, program, args) => {
    lockfile(file);

    const result = await runInstall(tree);

    expect(result).toEqual({
      ran: true,
      command: [program, ...args].join(" "),
      steps: [[program, ...args].join(" ")],
      from: "lockfile",
      inferred: true,
      ok: true,
    });
    expect(mockRunStreaming).toHaveBeenCalledWith(program, args, {
      cwd: tree,
      timeout: INSTALL_TIMEOUT_MS,
    });
  });

  it("takes the first match when several lockfiles exist", async () => {
    lockfile("yarn.lock");
    lockfile("package-lock.json");
    lockfile("pnpm-lock.yaml");

    const result = await runInstall(tree);

    expect(result).toMatchObject({ command: "pnpm install --frozen-lockfile" });
  });

  it("does not count bun.lockb", async () => {
    lockfile("bun.lockb");

    const result = await runInstall(tree);

    expect(result).toMatchObject({ ran: false });
    expect(mockRunStreaming).not.toHaveBeenCalled();
  });

  it("reports nothing to infer when there is no lockfile", async () => {
    const result = await runInstall(tree);

    expect(result).toEqual({
      ran: false,
      reason:
        "no postCreate command is set and no lockfile was found to infer one from",
    });
    expect(mockRunStreaming).not.toHaveBeenCalled();
  });

  it("bounds the install at ten minutes", () => {
    expect(INSTALL_TIMEOUT_MS).toBe(600_000);
  });
});

describe("runInstall postCreate", () => {
  it("wins over the lockfile and is not inferred", async () => {
    lockfile("pnpm-lock.yaml");
    postCreate = 'make "setup all"';

    const result = await runInstall(tree);

    expect(result).toEqual({
      ran: true,
      command: 'make "setup all"',
      steps: ['make "setup all"'],
      from: "git-config",
      inferred: false,
      ok: true,
    });
    // Split like agent.command: quotes group, no shell is involved.
    expect(mockRunStreaming).toHaveBeenCalledWith("make", ["setup all"], {
      cwd: tree,
      timeout: INSTALL_TIMEOUT_MS,
    });
  });

  it("runs on an interactive run with nothing else asked", async () => {
    setNonInteractive(false);
    postCreate = "make setup";

    const result = await runInstall(tree);

    expect(result).toMatchObject({ ran: true, inferred: false });
  });
});

describe("runInstall switches", () => {
  it("does not run on an interactive run without postCreate or --install", async () => {
    setNonInteractive(false);
    lockfile("pnpm-lock.yaml");

    const result = await runInstall(tree);

    expect(result).toMatchObject({ ran: false });
    expect(mockRunStreaming).not.toHaveBeenCalled();
  });

  it("runs on an interactive run with --install", async () => {
    setNonInteractive(false);
    lockfile("pnpm-lock.yaml");

    const result = await runInstall(tree, true);

    expect(result).toMatchObject({ ran: true, inferred: true });
  });

  it("runs by default when non-interactive", async () => {
    lockfile("package-lock.json");

    expect(await runInstall(tree)).toMatchObject({ ran: true });
  });

  it("--no-install alone switches it off, over a lockfile and non-interactive", async () => {
    lockfile("pnpm-lock.yaml");

    const result = await runInstall(tree, false);

    expect(result).toMatchObject({ ran: false });
    expect(mockRunStreaming).not.toHaveBeenCalled();
  });

  it("--no-install also wins over postCreate", async () => {
    postCreate = "make setup";

    expect(await runInstall(tree, false)).toMatchObject({ ran: false });
    expect(mockRunStreaming).not.toHaveBeenCalled();
  });
});

describe("runInstall outcomes", () => {
  it("reports ran:false when the binary is not on PATH", async () => {
    lockfile("bun.lock");
    vi.mocked(cli.commandExists).mockResolvedValueOnce(false);

    const result = await runInstall(tree);

    expect(result).toEqual({ ran: false, reason: "bun is not on PATH" });
    expect(cli.commandExists).toHaveBeenCalledWith("bun");
    expect(mockRunStreaming).not.toHaveBeenCalled();
  });

  it("reports a non-zero exit as ok:false without throwing", async () => {
    lockfile("package-lock.json");
    mockRunStreaming.mockResolvedValueOnce({ exitCode: 1 });

    const result = await runInstall(tree);

    expect(result).toEqual({
      ran: true,
      command: "npm ci",
      steps: ["npm ci"],
      from: "lockfile",
      inferred: true,
      ok: false,
      reason: "exited with code 1",
    });
  });

  it("reports a timeout as ok:false with the runner's message", async () => {
    lockfile("package-lock.json");
    mockRunStreaming.mockRejectedValueOnce(
      new Error("npm did not finish within 600s"),
    );

    const result = await runInstall(tree);

    expect(result).toMatchObject({
      ran: true,
      ok: false,
      reason: "npm did not finish within 600s",
    });
  });
});

// Phase 7 (#181), D15 and D18: expected values come from the plan's Done-when
// ("steps stop at the first failure with installed.ok false, command the
// failing step and steps the ones run") and D18's `from` values.
describe("runInstall file steps", () => {
  beforeEach(() => {
    projectSteps = ["pnpm install", "pnpm prisma generate", "pnpm build"];
  });

  it("runs each step in order, by argv, in the new tree, each bounded", async () => {
    const result = await runInstall(tree);

    expect(result).toEqual({
      ran: true,
      command: "pnpm build",
      steps: ["pnpm install", "pnpm prisma generate", "pnpm build"],
      from: "project",
      inferred: false,
      ok: true,
    });
    expect(mockRunStreaming.mock.calls).toEqual([
      ["pnpm", ["install"], { cwd: tree, timeout: INSTALL_TIMEOUT_MS }],
      [
        "pnpm",
        ["prisma", "generate"],
        { cwd: tree, timeout: INSTALL_TIMEOUT_MS },
      ],
      ["pnpm", ["build"], { cwd: tree, timeout: INSTALL_TIMEOUT_MS }],
    ]);
  });

  it("stops at the first failure: command is that step, steps are the ones run", async () => {
    mockRunStreaming
      .mockResolvedValueOnce({ exitCode: 0 })
      .mockResolvedValueOnce({ exitCode: 3 });

    const result = await runInstall(tree);

    expect(result).toEqual({
      ran: true,
      command: "pnpm prisma generate",
      steps: ["pnpm install", "pnpm prisma generate"],
      from: "project",
      inferred: false,
      ok: false,
      reason: "exited with code 3",
    });
    expect(mockRunStreaming).toHaveBeenCalledTimes(2);
  });

  it("stops at a timeout the same way", async () => {
    mockRunStreaming.mockRejectedValueOnce(
      new Error("pnpm did not finish within 600s"),
    );

    const result = await runInstall(tree);

    expect(result).toMatchObject({
      ok: false,
      command: "pnpm install",
      steps: ["pnpm install"],
      reason: "pnpm did not finish within 600s",
    });
    expect(mockRunStreaming).toHaveBeenCalledTimes(1);
  });

  it("fails the run at a step whose program is not on PATH", async () => {
    vi.mocked(cli.commandExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await runInstall(tree);

    expect(result).toMatchObject({
      ok: false,
      command: "pnpm prisma generate",
      steps: ["pnpm install", "pnpm prisma generate"],
      reason: "pnpm is not on PATH",
    });
    expect(mockRunStreaming).toHaveBeenCalledTimes(1);
  });

  it("runs them on an interactive run with nothing else asked", async () => {
    setNonInteractive(false);

    expect(await runInstall(tree)).toMatchObject({
      ran: true,
      from: "project",
    });
  });

  it("an empty list is the same as unset: the lockfile is inferred", async () => {
    projectSteps = [];
    lockfile("package-lock.json");

    expect(await runInstall(tree)).toMatchObject({
      from: "lockfile",
      command: "npm ci",
    });
  });

  it("a personal postCreate wins over the file's steps (D2)", async () => {
    postCreate = "make setup";

    expect(await runInstall(tree)).toMatchObject({
      from: "git-config",
      steps: ["make setup"],
    });
    expect(mockRunStreaming).toHaveBeenCalledTimes(1);
  });

  it("--no-install runs none of them", async () => {
    expect(await runInstall(tree, false)).toMatchObject({ ran: false });
    expect(mockRunStreaming).not.toHaveBeenCalled();
  });
});

// #281 D10: git postCreate, then the approved project steps, then the user
// file's, then the lockfile. Each layer wins whole (none appends): that is how
// the git and project layers already behave. The expected sources and steps
// are read off that order, not off the code's output.
describe("runInstall user file steps (#281 D10)", () => {
  beforeEach(() => {
    userSteps = ["pnpm install", "pnpm build"];
  });

  it("runs the user file's steps, in order, when nothing above sets any", async () => {
    lockfile("package-lock.json");

    const result = await runInstall(tree);

    expect(result).toEqual({
      ran: true,
      command: "pnpm build",
      steps: ["pnpm install", "pnpm build"],
      from: "user",
      inferred: false,
      ok: true,
    });
    expect(mockRunStreaming.mock.calls).toEqual([
      ["pnpm", ["install"], { cwd: tree, timeout: INSTALL_TIMEOUT_MS }],
      ["pnpm", ["build"], { cwd: tree, timeout: INSTALL_TIMEOUT_MS }],
    ]);
  });

  it("outranks the lockfile and counts as configured for an interactive run", async () => {
    setNonInteractive(false);

    expect(await runInstall(tree)).toMatchObject({
      ran: true,
      from: "user",
    });
  });

  it("yields to the project file's steps", async () => {
    projectSteps = ["make setup"];

    expect(await runInstall(tree)).toMatchObject({
      from: "project",
      steps: ["make setup"],
    });
  });

  it("yields to git config's postCreate", async () => {
    projectSteps = ["make setup"];
    postCreate = "make personal";

    expect(await runInstall(tree)).toMatchObject({
      from: "git-config",
      steps: ["make personal"],
    });
  });

  it("is not read when a layer above it answers", async () => {
    const spy = vi.spyOn(projectConfig, "getUserPostCreateSteps");
    projectSteps = ["make setup"];

    await runInstall(tree);

    expect(spy).not.toHaveBeenCalled();
  });

  it("falls to the lockfile when the user file has no steps", async () => {
    userSteps = [];
    lockfile("package-lock.json");

    expect(await runInstall(tree)).toMatchObject({
      from: "lockfile",
      steps: ["npm ci"],
    });
  });

  it("does not run with --no-install", async () => {
    expect(await runInstall(tree, false)).toMatchObject({ ran: false });
  });
});
