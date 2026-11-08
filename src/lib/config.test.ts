import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expectCommands } from "../test-setup.js";
import * as cli from "./cli.js";
import {
  getConfigValue,
  gitGetConfigValue,
  gitSetConfigValue,
} from "./config.js";
import { PERSONAL_KEYS } from "./config-keys.js";
import { SECRET_CONFIG_NAMES } from "./constants.js";
import * as projectConfig from "./project-config.js";
import type { ConfigName } from "./types.js";
import * as userConfig from "./user-config.js";

describe("git config", () => {
  // The value §7 case 3 stores by hand: a quote, a backtick and a semicolon,
  // every one of which the old `git config … "${value}"` form handed to a shell.
  const hostileValue = 'x"; touch /tmp/pwned; #`whoami`';

  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git config northguild.worktree.defaultSourceBranch",
      "git config northguild.worktree.codeEditor",
      "git config northguild.worktree.codeEditor code",
      `git config northguild.worktree.codeEditor "${hostileValue}"`,
    );
  });

  it("returns git config value", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("origin/main");

    const value = await gitGetConfigValue("defaultSourceBranch");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.defaultSourceBranch",
    ]);
    expect(value).toBe("origin/main");
  });

  it("returns empty string when git config lookup fails", async () => {
    const runSpy = vi.spyOn(cli, "run").mockRejectedValueOnce(new Error());

    const value = await gitGetConfigValue("defaultSourceBranch");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.defaultSourceBranch",
    ]);
    expect(value).toBe("");
  });

  it("sets git config value", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("");

    await gitSetConfigValue("codeEditor", "code");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.codeEditor",
      "code",
    ]);
  });

  // The point of the argv form: a value carrying shell metacharacters is one
  // element on the way out and the same string on the way back, with nothing in
  // between that could parse it.
  it("round-trips a value containing a quote, a backtick and a semicolon", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(hostileValue);

    await gitSetConfigValue("codeEditor", hostileValue);
    const value = await gitGetConfigValue("codeEditor");

    expect(runSpy).toHaveBeenNthCalledWith(1, "git", [
      "config",
      "northguild.worktree.codeEditor",
      hostileValue,
    ]);
    // One argv element, not a shell string that happens to contain the value.
    expect(runSpy.mock.calls[0]?.[1]).toHaveLength(3);
    // The read is `git config <key>` with no value: a second argument would write.
    expect(runSpy).toHaveBeenNthCalledWith(2, "git", [
      "config",
      "northguild.worktree.codeEditor",
    ]);
    expect(value).toBe(hostileValue);
  });
});

// #281 D9: personal keys read git, then the user file; team keys go through
// resolveTeamConfig (whose table is in project-config.test.ts); secrets read
// git only. Expected values follow D2/D9 and the key classes in config-keys.ts,
// not the reader's output.
describe("getConfigValue (#281 D9)", () => {
  let scratch: string;
  let gitValues: Record<string, string>;

  // A value the user file's schema accepts, and a different one git holds.
  const BOOLEAN_KEYS = new Set([
    "herdr.focus",
    "rex.focus",
    "jira.autoAssign",
    "jira.autoStart",
    "github.autoAssign",
    "linear.autoStart",
    "linear.agentContext",
    "clickup.autoAssign",
    "clickup.autoStart",
  ]);
  function userValue(key: string) {
    if (key === "opener") {
      return "rex";
    }
    return BOOLEAN_KEYS.has(key) ? "true" : "from-user";
  }
  function yamlFor(key: string, value: string) {
    const [head, child] = key.split(".");
    const scalar = BOOLEAN_KEYS.has(key) ? value : JSON.stringify(value);
    return child === undefined
      ? `${head}: ${scalar}\n`
      : `${head}:\n  ${child}: ${scalar}\n`;
  }
  function userFile(content: string) {
    const file = path.join(scratch, "user-config.yml");
    fs.writeFileSync(file, content);
    vi.stubEnv(userConfig.USER_CONFIG_OVERRIDE_ENV, file);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wt-config-"));
    userConfig.resetUserConfigCache();
    // Never the real $HOME: the default location is inside the scratch dir.
    vi.stubEnv(userConfig.USER_CONFIG_OVERRIDE_ENV, "");
    vi.stubEnv("XDG_CONFIG_HOME", path.join(scratch, "xdg"));
    gitValues = {};
    vi.spyOn(cli, "run").mockImplementation(async (_cmd, args) => {
      const key = String(args?.[1] ?? "").replace("northguild.worktree.", "");
      const value = gitValues[key];
      if (value === undefined) {
        throw new Error("not set");
      }
      return value;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  describe.each([...PERSONAL_KEYS])("personal key %s", (key) => {
    const name = key as ConfigName;

    it("git config wins over the user file", async () => {
      gitValues[key] = "from-git";
      userFile(yamlFor(key, userValue(key)));

      expect(await getConfigValue(name)).toEqual({
        value: "from-git",
        source: "git-config",
      });
    });

    it("the user file answers when git config does not", async () => {
      userFile(yamlFor(key, userValue(key)));

      expect(await getConfigValue(name)).toEqual({
        value: userValue(key),
        source: "user",
      });
    });

    it("git config alone answers without reading the user file", async () => {
      gitValues[key] = "from-git";
      const load = vi.spyOn(userConfig, "loadUserConfig");

      expect(await getConfigValue(name)).toEqual({
        value: "from-git",
        source: "git-config",
      });
      expect(load).not.toHaveBeenCalled();
    });

    it("is empty with source default when neither sets it", async () => {
      expect(await getConfigValue(name)).toEqual({
        value: "",
        source: "default",
      });
    });
  });

  it("reads the user file's false as the text git config would hold", async () => {
    userFile("rex:\n  focus: false\n");

    expect(await getConfigValue("rex.focus")).toEqual({
      value: "false",
      source: "user",
    });
  });

  describe.each([...SECRET_CONFIG_NAMES])("secret key %s", (key) => {
    it("reads git config only: the user file is never consulted", async () => {
      gitValues[key] = "s3cret";
      const load = vi.spyOn(userConfig, "loadUserConfig");
      const project = vi.spyOn(projectConfig, "loadProjectConfig");

      expect(await getConfigValue(key)).toEqual({
        value: "s3cret",
        source: "git-config",
      });
      expect(load).not.toHaveBeenCalled();
      expect(project).not.toHaveBeenCalled();
    });

    it("is empty with source default when git config has none, even with a user file", async () => {
      userFile('opener: "none"\n');
      const load = vi.spyOn(userConfig, "loadUserConfig");

      expect(await getConfigValue(key)).toEqual({
        value: "",
        source: "default",
      });
      expect(load).not.toHaveBeenCalled();
    });
  });

  it("hands a team key to the team resolver, user layer included", async () => {
    userFile('jira:\n  host: "user.example.com"\n');
    vi.spyOn(projectConfig, "loadProjectConfig").mockResolvedValue({
      status: "none",
      reason: "no-ref",
      warnings: [],
    });

    expect(await getConfigValue("jira.host")).toEqual({
      value: "user.example.com",
      source: "user",
    });
  });

  it("does not answer postCreate from the user file: its steps are a list with their own reader", async () => {
    userFile("postCreate:\n  - pnpm install\n");

    expect(await getConfigValue("postCreate")).toEqual({
      value: "",
      source: "default",
    });
  });

  it("throws a bad user file's error rather than masking it", async () => {
    userFile("opener: [not, text]\n");

    await expect(getConfigValue("opener")).rejects.toBeInstanceOf(
      userConfig.UserConfigError,
    );
  });

  it("reads nothing and says nothing when there is no user file", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await getConfigValue("opener")).toEqual({
      value: "",
      source: "default",
    });
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});
