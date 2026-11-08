import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "@oclif/core";
import Branch from "../commands/branch.js";
import { resolveGitHubHost } from "../integrations/github.js";
import { mockRun, mockSpawnDetached } from "../test-setup.js";
import { BaseCommand } from "./base-command.js";
import { resetProjectConfigCache } from "./project-config.js";
import { resetUserConfigCache } from "./user-config.js";

// The readers migrated in #281 phase 3 against the real layered reader and a
// real user file: git config says nothing and there is no .worktree.yml, so
// the user file's value is the only answer (D2: git, project file, user file,
// default). Each expected value is the value written into the file below, and
// the contrast is what the same run does with no file (§2, today's behaviour).
vi.unmock("./config.js");

class TestCommand extends BaseCommand {
  async run() {}

  open(path: string) {
    return this.openWorktreePath(path);
  }

  dispatch(path: string, prompt: string) {
    return this.dispatchAgent(path, prompt);
  }
}

const worktreePath = "/repo/project.worktrees/feature/test";
let dir: string;

function userFile(yaml: string) {
  const file = join(dir, "config.yml");
  writeFileSync(file, yaml);
  vi.stubEnv("WORKTREE_USER_CONFIG", file);
  resetUserConfigCache();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "worktree-user-readers-"));
  // Every git call answers with nothing: no git config key, no origin/HEAD,
  // no project file.
  mockRun.mockResolvedValue("");
  resetProjectConfigCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("a user file changes what the commands do (#281 phase 3)", () => {
  it("opener: none in the file opens nothing, where no file opens the editor", async () => {
    const command = new TestCommand([], {
      runCommand: vi.fn(),
    } as unknown as Config);
    vi.spyOn(command, "log").mockImplementation(() => {});

    userFile("opener: none\ncodeEditor: code\n");
    const outcome = await command.open(worktreePath);

    expect(outcome.opener).toBe("none");
    expect(mockRun).not.toHaveBeenCalledWith("code", [worktreePath]);
  });

  it("codeEditor in the file is the editor the worktree opens in", async () => {
    const command = new TestCommand([], {
      runCommand: vi.fn(),
    } as unknown as Config);
    vi.spyOn(command, "log").mockImplementation(() => {});

    userFile("codeEditor: code --reuse-window\n");
    await command.open(worktreePath);

    expect(mockRun).toHaveBeenCalledWith("code", [
      "--reuse-window",
      worktreePath,
    ]);
  });

  it("no file opens nothing, as before", async () => {
    const command = new TestCommand([], {
      runCommand: vi.fn(),
    } as unknown as Config);
    const log = vi.spyOn(command, "log").mockImplementation(() => {});

    await command.open(worktreePath);

    expect(mockRun).not.toHaveBeenCalledWith("code", expect.anything());
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Worktree created in"),
    );
  });

  it("agent.command in the file is the program the brief is handed to", async () => {
    const command = new TestCommand([], {
      runCommand: vi.fn(),
    } as unknown as Config);
    vi.spyOn(command, "log").mockImplementation(() => {});

    userFile("agent:\n  command: claude --bg\n");
    await command.dispatch(worktreePath, "do the thing");

    expect(mockSpawnDetached).toHaveBeenCalledWith(
      "claude",
      ["--bg", "do the thing"],
      expect.objectContaining({ cwd: worktreePath }),
    );
  });

  it("github.host in the file is the host GitHub requests go to", async () => {
    expect(await resolveGitHubHost()).toBe("github.com");

    userFile("github:\n  host: ghe.example.com\n");

    expect(await resolveGitHubHost()).toBe("ghe.example.com");
  });

  it("defaultSourceBranch in the file is the branch a new worktree starts from", async () => {
    const branch = new Branch([], { runCommand: vi.fn() } as unknown as Config);
    const sourceOf = () =>
      (
        branch as unknown as { getSourceBranch(): Promise<string> }
      ).getSourceBranch();

    expect(await sourceOf()).toBe("origin/main");

    userFile("defaultSourceBranch: origin/develop\n");

    expect(await sourceOf()).toBe("origin/develop");
  });
});
