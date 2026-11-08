/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import * as rex from "../integrations/rex.js";
import * as projectConfig from "../lib/project-config.js";
import { resetProjectConfigCache } from "../lib/project-config.js";
import { loadUserConfig, resetUserConfigCache } from "../lib/user-config.js";
import { mockRun } from "../test-setup.js";
import Config from "./config.js";

// The user config file against `worktree config` (#281 phase 4). The real
// layered reader runs here, over a real file in a temp directory named by
// WORKTREE_USER_CONFIG; git config is whatever `stored` holds, answered at the
// subprocess seam, so nothing reads the real $HOME or a real repository.
vi.unmock("../lib/config.js");

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

describe("config command and the user file", () => {
  let dir: string;
  let userFile: string;
  let stored: Record<string, string>;
  let config: Config;
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  const printed = () => log.mock.calls.map(([line]: [string]) => line);
  const warned = () => warn.mock.calls.map(([line]: [string]) => String(line));
  // The `git config <key> <value>` writes, as [key, value] without the namespace.
  const sets = () =>
    mockRun.mock.calls
      .map((call) => call as unknown as [string, string[]])
      .filter(
        ([file, args]) =>
          file === "git" && args[0] === "config" && args.length === 3,
      )
      .map(([, args]) => [
        (args[1] ?? "").replace("northguild.worktree.", ""),
        args[2] ?? "",
      ]);

  function parsed(args: object, flags: object) {
    (config as any).parse = vi.fn().mockResolvedValue({ args, flags });
  }

  function writeUser(yaml: string) {
    fs.writeFileSync(userFile, yaml);
    resetUserConfigCache();
  }

  async function withProjectFile(yaml: string) {
    const file = path.join(dir, ".worktree.yml");
    fs.writeFileSync(file, yaml);
    const result = await projectConfig.readProjectConfig({
      WORKTREE_PROJECT_CONFIG: file,
    });
    vi.spyOn(projectConfig, "loadProjectConfig").mockResolvedValue(result);
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-config-user-"));
    userFile = path.join(dir, "home", "config.yml");
    fs.mkdirSync(path.dirname(userFile));
    vi.stubEnv("WORKTREE_USER_CONFIG", userFile);
    resetUserConfigCache();
    stored = {};
    mockRun.mockImplementation(async (_file: string, args: string[]) => {
      const key = args[1]?.replace("northguild.worktree.", "") ?? "";
      if (args[0] === "config" && args.length === 2) {
        return stored[key] ?? "";
      }
      return "";
    });
    config = new Config([], { runCommand: vi.fn() } as any);
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    warn = vi.spyOn(config, "warn").mockImplementation((() => {}) as any);
    vi.spyOn(projectConfig, "loadProjectConfig").mockResolvedValue({
      status: "none",
      reason: "no-file",
      warnings: [],
    });
    vi.spyOn(projectConfig, "offerProjectConfig").mockResolvedValue();
    vi.spyOn(rex, "isRexInstalled").mockResolvedValue(false);
    vi.mocked(checkbox).mockResolvedValue([] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetUserConfigCache();
    resetProjectConfigCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // D7: `--user <key> <value>` writes the file and not git config.
  describe("--user <key> <value>", () => {
    it("writes the key to the file, says where, and leaves git config alone", async () => {
      parsed({ name: "agent.command", value: "claude --bg" }, { user: true });

      await config.run();

      expect(fs.readFileSync(userFile, "utf8")).toContain(
        "agent:\n  command: claude --bg\n",
      );
      expect(printed()).toEqual([`Set agent.command in ${userFile}.`]);
      expect(sets()).toEqual([["has-called-config", "true"]]);
    });

    // §4: validated through validateConfigValue, the validator git writes use.
    it("validates the value as a git write would, and writes nothing on a bad one", async () => {
      parsed({ name: "opener", value: "emacs" }, { user: true });

      await expect(config.run()).rejects.toThrow("Opener must be");

      expect(fs.existsSync(userFile)).toBe(false);
    });

    // D6: exit 2 invalid_value, the key named, the value never.
    it("refuses a secret key without echoing the value", async () => {
      parsed({ name: "github.token", value: "ghp_TOPSECRET" }, { user: true });

      const error = await config.run().catch((caught) => caught);

      expect(error).toMatchObject({
        code: "invalid_value",
        oclif: { exit: 2 },
      });
      expect(error.message).toContain("github.token");
      expect(error.message).not.toContain("ghp_TOPSECRET");
      expect(fs.existsSync(userFile)).toBe(false);
    });

    // §4: a key that is not a file key. `has-called-config` is a config name
    // the reader does not accept.
    it("refuses a key the file cannot hold", async () => {
      parsed({ name: "has-called-config", value: "true" }, { user: true });

      await expect(config.run()).rejects.toThrow(
        "has-called-config cannot be set in the user config file",
      );
      expect(fs.existsSync(userFile)).toBe(false);
    });

    // §4: an equal value is a no-op; the bytes are the same afterwards.
    it("changes nothing when the file already holds that value", async () => {
      const odd = "codeEditor:   code   # keep\n";
      writeUser(odd);
      parsed({ name: "codeEditor", value: "code" }, { user: true });

      await config.run();

      expect(fs.readFileSync(userFile, "utf8")).toBe(odd);
      expect(printed()).toEqual([
        `codeEditor is already set to that in ${userFile}.`,
      ]);
    });

    // D8: a file that does not parse is never overwritten.
    it("stops on a file that does not parse and leaves it as it is", async () => {
      const broken = "opener: [auto\n";
      writeUser(broken);
      parsed({ name: "codeEditor", value: "code" }, { user: true });

      await expect(config.run()).rejects.toThrow(/not valid YAML/);

      expect(fs.readFileSync(userFile, "utf8")).toBe(broken);
    });

    // D7: composes with a key and a value only.
    it.each([
      ["--list", {}, { user: true, list: true }],
      [
        "--missing",
        { name: "codeEditor", value: "code" },
        { user: true, missing: true },
      ],
      [
        "--names",
        { name: "codeEditor", value: "code" },
        { user: true, names: "codeEditor" },
      ],
      ["a key alone", { name: "codeEditor" }, { user: true }],
      ["no arguments (the wizard)", {}, { user: true }],
    ])("is refused with %s", async (_label, args, flags) => {
      parsed(args, flags);

      await expect(config.run()).rejects.toThrow(
        "--user takes a key and a value",
      );
      expect(fs.existsSync(userFile)).toBe(false);
      expect(vi.mocked(input)).not.toHaveBeenCalled();
    });

    it("is refused with --project and with --approve", async () => {
      parsed({}, { user: true, project: true });
      await expect(config.run()).rejects.toThrow(
        "--project cannot be combined",
      );
      parsed({}, { user: true, approve: true });
      await expect(config.run()).rejects.toThrow(
        "--approve cannot be combined",
      );
    });
  });

  // D11. The git-wins and project-wins forms are the existing ones in
  // `config --list` for `.worktree.yml`; the user forms are D11's wording.
  describe("--list origins", () => {
    async function list() {
      parsed({}, { list: true, missing: false });
      await config.run();
      return printed();
    }

    it("labels a value read only from the file `(user config)`", async () => {
      writeUser("agent:\n  command: claude\n");
      expect(await list()).toContain("agent.command=claude (user config)");
    });

    it("labels a git value that differs from the file `(overrides user config: <file value>)`", async () => {
      writeUser("codeEditor: code\n");
      stored.codeEditor = "vim";
      expect(await list()).toContain(
        "codeEditor=vim (overrides user config: code)",
      );
    });

    it("labels a git value equal to the file's `(user config)`", async () => {
      writeUser("codeEditor: code\n");
      stored.codeEditor = "code";
      expect(await list()).toContain("codeEditor=code (user config)");
    });

    // The project file outranks the user file (D2): the existing project form.
    it("keeps the project file's own label where it wins over the user file", async () => {
      await withProjectFile("jira:\n  host: https://project.atlassian.net\n");
      writeUser("jira:\n  host: https://user.atlassian.net\n");
      const lines = await list();
      expect(lines).toContain(
        "jira.host=https://project.atlassian.net (.worktree.yml)",
      );
      expect(lines.join("\n")).not.toContain("user.atlassian.net");
    });

    it("keeps the existing override form where git beats the project file", async () => {
      await withProjectFile("jira:\n  host: https://project.atlassian.net\n");
      writeUser("jira:\n  host: https://user.atlassian.net\n");
      stored["jira.host"] = "https://mine.atlassian.net";
      expect(await list()).toContain(
        "jira.host=https://mine.atlassian.net (overrides .worktree.yml: https://project.atlassian.net)",
      );
    });

    it("lists a key set nowhere by name alone", async () => {
      writeUser("codeEditor: code\n");
      expect(await list()).toContain("agent.command");
    });

    it("does not list a key the file sets under --missing", async () => {
      writeUser("agent:\n  command: claude\n");
      parsed({}, { list: true, missing: true });
      await config.run();
      expect(printed().join("\n")).not.toMatch(/^agent\.command/m);
    });

    // File-derived text is printed through showVisibly (D16).
    it("shows a file value's control characters escaped", async () => {
      writeUser('codeEditor: "co\\u001b[2Jde"\n');
      expect(await list()).toContain("codeEditor=co\\x1b[2Jde (user config)");
    });
  });

  // D7: reading a key gives the resolved value.
  describe("worktree config <key>", () => {
    it("prints the file's value where git config has none", async () => {
      writeUser("codeEditor: code\n");
      parsed({ name: "codeEditor" }, {});
      await config.run();
      expect(printed()).toEqual(["code"]);
    });

    it("prints git config's value over the file's", async () => {
      writeUser("codeEditor: code\n");
      stored.codeEditor = "vim";
      parsed({ name: "codeEditor" }, {});
      await config.run();
      expect(printed()).toEqual(["vim"]);
    });
  });

  // §2: the command that repairs a bad file must run.
  describe("with a user file that cannot be used", () => {
    const BAD = "opener: [auto\n";

    it.each([
      ["--list", {}, { list: true, missing: false }],
      ["<key>", { name: "codeEditor" }, {}],
      ["the wizard", {}, { missing: false }],
    ])("%s warns, names the file and exits 0", async (_label, args, flags) => {
      writeUser(BAD);
      vi.mocked(input).mockResolvedValue("origin/main" as never);
      parsed(args, flags);

      await expect(config.run()).resolves.toBeUndefined();

      const warnings = warned();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(userFile);
      expect(warnings[0]).toContain("Ignoring the user config file");
    });

    it("still lists git config's values", async () => {
      writeUser(BAD);
      stored.codeEditor = "vim";
      parsed({}, { list: true, missing: false });
      await config.run();
      expect(printed()).toContain("codeEditor=vim");
    });

    it("shows the file's path with its control characters escaped", async () => {
      const odd = path.join(dir, "home", "bad\u001b[2J.yml");
      fs.writeFileSync(odd, BAD);
      vi.stubEnv("WORKTREE_USER_CONFIG", odd);
      resetUserConfigCache();
      parsed({}, { list: true, missing: false });
      await config.run();
      expect(warned().join("")).not.toContain("\u001b");
    });
  });

  // §2 and HEAD: a project file that cannot be used is warned about and passed
  // over; the wizard's prefill and pre-tick reads go through the real layered
  // reader (resolveTeamConfig), which would rethrow it.
  describe("with a .worktree.yml that cannot be used", () => {
    beforeEach(() => {
      writeUser("opener: auto\n");
      vi.mocked(projectConfig.loadProjectConfig).mockRestore();
      const bad = path.join(dir, "bad.worktree.yml");
      fs.writeFileSync(bad, "jira: [host\n");
      vi.stubEnv("WORKTREE_PROJECT_CONFIG", bad);
      resetProjectConfigCache();
      vi.mocked(input).mockImplementation(
        (async (prompt: { default?: string }) =>
          prompt.default ?? "origin/main") as never,
      );
      vi.mocked(confirm).mockResolvedValue(false as never);
      vi.mocked(checkbox).mockImplementation((async (prompt: {
        choices: { value: string }[];
      }) => prompt.choices.map((choice) => choice.value)) as never);
    });

    it.each([
      ["a bare", { missing: false }],
      ["a --missing", { missing: true }],
    ])("%s wizard run warns once and exits 0", async (_label, flags) => {
      parsed({}, flags);

      await expect(config.run()).resolves.toBeUndefined();

      expect(warned()).toHaveLength(1);
      expect(warned()[0]).toContain("bad.worktree.yml");
    });

    it("leaves nothing treated as absent once config has finished", async () => {
      writeUser("opener: [auto\n");
      parsed({}, { list: true, missing: false });

      await config.run();

      await expect(loadUserConfig()).rejects.toThrow();
      await expect(projectConfig.loadProjectConfig()).rejects.toThrow();
    });
  });

  // D11: a user-file key is already set, as a project-file key is.
  describe("the wizard", () => {
    const askedMessages = () =>
      [...vi.mocked(input).mock.calls, ...vi.mocked(select).mock.calls].map(
        ([prompt]) => (prompt as { message: string }).message,
      );

    beforeEach(() => {
      // Answering a prompt with what it offered is pressing Enter.
      vi.mocked(input).mockImplementation(
        (async (prompt: { default?: string }) => prompt.default ?? "") as never,
      );
      vi.mocked(confirm).mockResolvedValue(false as never);
      vi.mocked(checkbox).mockImplementation((async (prompt: {
        choices: { value: string }[];
      }) => prompt.choices.map((choice) => choice.value)) as never);
    });

    it("skips the keys the file sets and says which, and why", async () => {
      writeUser("codeEditor: code\nagent:\n  command: claude\n");
      parsed({}, { missing: false });

      await config.run();

      expect(printed()).toContain(
        `Your user config (${userFile}) sets codeEditor, agent.command, so the wizard does not ask for them. Change one with \`worktree config --user <key> <value>\`, or for this repository only with \`worktree config <key> <value>\`.`,
      );
      expect(askedMessages().join("\n")).not.toContain("Which coding agent");
    });

    // The bug D11 names: Enter on the agent.command question stored "".
    it("never stores an empty value over a key only the file sets", async () => {
      writeUser("agent:\n  command: claude\n");
      parsed({}, { missing: false });

      await config.run();

      expect(sets().filter(([key]) => key === "agent.command")).toEqual([]);
    });

    it("prefills a named key from the file, so Enter keeps it rather than storing nothing", async () => {
      writeUser("agent:\n  command: claude\n");
      parsed({}, { names: "agent.command", missing: false });

      await config.run();

      expect(sets()).toContainEqual(["agent.command", "claude"]);
      expect(sets().map(([, value]) => value)).not.toContain("");
    });

    it("ticks an item for a key only the file sets", async () => {
      writeUser("branchPrefix:\n  feature: feat/\n");
      parsed({}, { missing: false });
      await config.run();
      const choices = vi.mocked(checkbox).mock.calls[0]?.[0].choices as {
        value: string;
        checked: boolean;
      }[];
      expect(choices.find((c) => c.value === "branchPrefixes")?.checked).toBe(
        true,
      );
    });

    it("names a file key even when git config holds it too", async () => {
      writeUser("opener: auto\n");
      stored.opener = "auto";
      parsed({}, { missing: false });
      await config.run();
      expect(printed().join("\n")).toContain("Your user config");
    });
  });
});
