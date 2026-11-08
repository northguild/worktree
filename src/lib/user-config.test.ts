import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadUserConfig,
  readUserConfig,
  resetUserConfigCache,
  UserConfigError,
  userConfigPath,
} from "./user-config.js";

let dir: string;
let home: string;

// Every path below is under a fresh temp directory; the real $HOME and
// $XDG_CONFIG_HOME are never read because env and home are passed in.
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-user-config-"));
  home = path.join(dir, "home");
  fs.mkdirSync(home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetUserConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const defaultFile = () => path.join(home, ".config", "worktree", "config.yml");

describe("userConfigPath", () => {
  // D3: ~/.config/worktree/config.yml when XDG_CONFIG_HOME does not apply.
  it("defaults to ~/.config/worktree/config.yml", () => {
    expect(userConfigPath({}, home).path).toBe(defaultFile());
  });

  // D3 + XDG spec: an absolute XDG_CONFIG_HOME is honoured.
  it("honours an absolute XDG_CONFIG_HOME", () => {
    const xdg = path.join(dir, "xdg");
    expect(userConfigPath({ XDG_CONFIG_HOME: xdg }, home).path).toBe(
      path.join(xdg, "worktree", "config.yml"),
    );
  });

  // XDG spec: an empty value is treated as unset.
  it("ignores an empty XDG_CONFIG_HOME", () => {
    expect(userConfigPath({ XDG_CONFIG_HOME: "" }, home).path).toBe(
      defaultFile(),
    );
  });

  // XDG spec: a relative path is invalid and must be ignored.
  it("ignores a relative XDG_CONFIG_HOME", () => {
    expect(userConfigPath({ XDG_CONFIG_HOME: "rel/dir" }, home).path).toBe(
      defaultFile(),
    );
  });

  // D4: WORKTREE_USER_CONFIG wins over XDG_CONFIG_HOME, resolved to absolute.
  it("lets WORKTREE_USER_CONFIG override the location", () => {
    const file = path.join(dir, "mine.yml");
    expect(
      userConfigPath(
        { WORKTREE_USER_CONFIG: file, XDG_CONFIG_HOME: path.join(dir, "x") },
        home,
      ).path,
    ).toBe(file);
  });
});

describe("readUserConfig", () => {
  // §2: no file means no side effects, no warning.
  it("returns none with no warning when there is no file", async () => {
    const result = await readUserConfig({}, home);
    expect(result).toEqual({
      status: "none",
      reason: "no-file",
      path: defaultFile(),
      warnings: [],
    });
    expect(fs.existsSync(path.join(home, ".config"))).toBe(false);
  });

  it("returns none for an empty file", async () => {
    write(defaultFile(), "# nothing yet\n");
    const result = await readUserConfig({}, home);
    expect(result).toMatchObject({ status: "none", reason: "empty-file" });
  });

  // D5: personal keys and team fallbacks load, nested as in .worktree.yml.
  it("loads personal keys and team fallbacks", async () => {
    write(
      defaultFile(),
      [
        "opener: herdr",
        "defaultSourceBranch: develop",
        "herdr:",
        "  focus: false",
        "  agent: claude",
        "branchPrefix:",
        "  feature: feat/",
        "jira:",
        "  email: me@example.com",
        "  host: acme.atlassian.net",
        "  autoAssign: true",
        "postCreate:",
        "  - pnpm install",
        "",
      ].join("\n"),
    );
    const result = await readUserConfig({}, home);
    expect(result).toEqual({
      status: "loaded",
      path: defaultFile(),
      config: {
        opener: "herdr",
        defaultSourceBranch: "develop",
        herdr: { focus: false, agent: "claude" },
        branchPrefix: { feature: "feat/" },
        jira: {
          email: "me@example.com",
          host: "acme.atlassian.net",
          autoAssign: true,
        },
        postCreate: ["pnpm install"],
      },
      warnings: [],
    });
  });

  it("reads the file at an absolute XDG_CONFIG_HOME", async () => {
    const xdg = path.join(dir, "xdg");
    write(path.join(xdg, "worktree", "config.yml"), "opener: none\n");
    const result = await readUserConfig({ XDG_CONFIG_HOME: xdg }, home);
    expect(result).toMatchObject({
      status: "loaded",
      config: { opener: "none" },
    });
  });

  it("does not read XDG_CONFIG_HOME when it is relative or empty", async () => {
    write(defaultFile(), "opener: rex\n");
    for (const xdg of ["", "relative"]) {
      const result = await readUserConfig({ XDG_CONFIG_HOME: xdg }, home);
      expect(result).toMatchObject({
        status: "loaded",
        path: defaultFile(),
        config: { opener: "rex" },
      });
    }
  });

  it("reads the file WORKTREE_USER_CONFIG names", async () => {
    const file = write(path.join(dir, "elsewhere.yml"), "codeEditor: code\n");
    const result = await readUserConfig({ WORKTREE_USER_CONFIG: file }, home);
    expect(result).toMatchObject({
      status: "loaded",
      path: file,
      config: { codeEditor: "code" },
    });
  });

  // An override that names nothing is a mistake, unlike a missing default.
  it("throws when WORKTREE_USER_CONFIG names a missing file", async () => {
    const file = path.join(dir, "missing.yml");
    await expect(
      readUserConfig({ WORKTREE_USER_CONFIG: file }, home),
    ).rejects.toThrow(file);
  });

  // D6: exit 2 invalid_value, key named, value never.
  it("refuses a secret key, naming the key and not the value", async () => {
    write(
      defaultFile(),
      "github:\n  token: ghp_supersecretvalue\nopener: none\n",
    );
    const error = await readUserConfig({}, home).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserConfigError);
    const failure = error as UserConfigError;
    expect(failure.code).toBe("invalid_value");
    expect(failure.oclif.exit).toBe(2);
    expect(failure.message).toContain("github.token");
    expect(failure.message).toContain("(line 2)");
    expect(failure.message).not.toContain("ghp_supersecretvalue");
  });

  it("refuses a top-level secret key without printing its value", async () => {
    write(defaultFile(), "linear.apiKey: lin_api_topsecret\n");
    const error = (await readUserConfig({}, home).catch(
      (e: unknown) => e,
    )) as UserConfigError;
    expect(error.message).toContain("linear.apiKey");
    expect(error.message).not.toContain("lin_api_topsecret");
  });

  // D6: unknown keys warn once each and are ignored.
  it("warns about unknown keys and ignores them", async () => {
    write(
      defaultFile(),
      "opener: none\nfuture: 1\njira:\n  nonsense: x\n  branchType: []\n",
    );
    const result = await readUserConfig({}, home);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    expect(result.config).toEqual({ opener: "none", jira: {} });
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toContain("unknown key `future`");
    expect(result.warnings[1]).toContain("unknown key `jira.nonsense`");
    expect(result.warnings[2]).toContain("unknown key `jira.branchType`");
  });

  // A flat dotted key is not the file's shape; D6 says unknown keys warn.
  it("warns about an accepted key written flat instead of dropping it", async () => {
    write(defaultFile(), "opener: none\nherdr.focus: false\n");
    const result = await readUserConfig({}, home);
    expect(result).toMatchObject({
      status: "loaded",
      config: { opener: "none" },
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("unknown key `herdr.focus`");
  });

  // Same checks as .worktree.yml and `worktree config` for the same keys.
  it.each([
    ["github:\n  host: --hostname=evil\n", "github.host"],
    ["github:\n  host: https://ghe.example.com/x\n", "github.host"],
    ["github:\n  host: api.github.com\n", "github.host"],
    ["github:\n  repository: acme/widgets.git\n", "github.repository"],
    ["github:\n  repository: acme\n", "github.repository"],
    ['postCreate:\n  - "echo \\u001b[2J"\n', "postCreate[0]"],
    ['postCreate:\n  - "   "\n', "postCreate[0]"],
  ])("refuses %j", async (yaml, key) => {
    write(defaultFile(), yaml);
    const error = (await readUserConfig({}, home).catch(
      (e: unknown) => e,
    )) as UserConfigError;
    expect(error).toBeInstanceOf(UserConfigError);
    expect(error.message).toContain(key);
  });

  it("throws an error naming the path for malformed YAML", async () => {
    const file = write(defaultFile(), "opener: [unclosed\n");
    const error = (await readUserConfig({}, home).catch(
      (e: unknown) => e,
    )) as UserConfigError;
    expect(error).toBeInstanceOf(UserConfigError);
    expect(error.message).toContain(file);
    expect(error.message).toContain("(line");
  });

  it("names the key and line of an invalid value", async () => {
    const file = write(defaultFile(), "herdr:\n  focus: sometimes\n");
    const error = (await readUserConfig({}, home).catch(
      (e: unknown) => e,
    )) as UserConfigError;
    expect(error.message).toContain(file);
    expect(error.message).toContain("herdr.focus (line 2)");
  });

  it("rejects a file that is not a mapping", async () => {
    write(defaultFile(), "- a\n- b\n");
    await expect(readUserConfig({}, home)).rejects.toThrow("must be a mapping");
  });
});

describe("loadUserConfig", () => {
  // Reads once per process: a change after the first call is not seen until reset.
  it("reads once and caches until reset", async () => {
    const file = write(path.join(dir, "c.yml"), "opener: none\n");
    vi.stubEnv("WORKTREE_USER_CONFIG", file);
    const first = await loadUserConfig();
    fs.writeFileSync(file, "opener: rex\n");
    expect(await loadUserConfig()).toBe(first);
    resetUserConfigCache();
    expect(await loadUserConfig()).toMatchObject({
      config: { opener: "rex" },
    });
  });
});
