import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockRunStreaming } from "../test-setup.js";
import * as cli from "./cli.js";
import * as git from "./git.js";
import { INSTALL_TIMEOUT_MS, runInstall } from "./install.js";
import { setNonInteractive } from "./interaction.js";

let tree: string;
let postCreate: string;

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), "worktree-install-"));
  postCreate = "";
  vi.spyOn(git, "gitGetConfigValue").mockImplementation(async (name) =>
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
