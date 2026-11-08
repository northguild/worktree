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
  writeUserConfigValue,
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

// D8 and §4 "Writing": the mode values are D8's, the header text is §4's
// example, the nesting is the shape the reader accepts (§4 example file).
describe("writeUserConfigValue", () => {
  const HEADER =
    "# ~/.config/worktree/config.yml: personal defaults for every repository.\n" +
    "# Never put a token here; keep secrets in git config with `worktree config <key>`.\n";
  const mode = (target: string) => fs.statSync(target).mode & 0o777;
  const text = (target: string) => fs.readFileSync(target, "utf8");

  let umask: number;
  beforeEach(() => {
    // 0 so a mode that is exactly 0700 / 0600 is the code's doing, not the mask's.
    umask = process.umask(0);
  });
  afterEach(() => {
    process.umask(umask);
  });

  // D8: directory 0700, file 0600, header naming the path and saying no secrets;
  // §4: a dotted key is nested.
  it("creates the directory 0700 and the file 0600 with the header and a nested key", () => {
    const result = writeUserConfigValue(
      "agent.command",
      "claude --bg",
      {},
      home,
    );
    expect(result).toEqual({ path: defaultFile(), changed: true });
    expect(mode(path.dirname(defaultFile()))).toBe(0o700);
    expect(mode(defaultFile())).toBe(0o600);
    expect(text(defaultFile())).toBe(
      `${HEADER}agent:\n  command: claude --bg\n`,
    );
  });

  // §4: what the writer writes is what the reader accepts, for each value shape.
  it("writes what the reader reads back, for text, a boolean and a step list", async () => {
    writeUserConfigValue("codeEditor", "code", {}, home);
    writeUserConfigValue("herdr.focus", "false", {}, home);
    writeUserConfigValue("postCreate", "pnpm install", {}, home);
    const result = await readUserConfig({}, home);
    expect(result).toMatchObject({
      status: "loaded",
      config: {
        codeEditor: "code",
        herdr: { focus: false },
        postCreate: ["pnpm install"],
      },
    });
  });

  // D8: comments and key order survive; the new key goes after the existing ones.
  it("keeps an existing comment and the order of keys", () => {
    const before = "# my editor\ncodeEditor: code # works\nopener: auto\n";
    write(defaultFile(), before);
    writeUserConfigValue("agent.command", "claude", {}, home);
    expect(text(defaultFile())).toBe(`${before}agent:\n  command: claude\n`);
  });

  it("changes a value in place without losing its comment", () => {
    write(defaultFile(), "# top\ncodeEditor: code # works\nopener: auto\n");
    writeUserConfigValue("codeEditor", "zed", {}, home);
    expect(text(defaultFile())).toBe(
      "# top\ncodeEditor: zed # works\nopener: auto\n",
    );
  });

  // D8: the header is for a freshly written file only.
  it("adds no header to a file that already exists", () => {
    write(defaultFile(), "opener: auto\n");
    writeUserConfigValue("codeEditor", "code", {}, home);
    expect(text(defaultFile())).toBe("opener: auto\ncodeEditor: code\n");
  });

  // D6: exit 2, naming the key; never the value.
  it("refuses a secret key and writes nothing", () => {
    let error: unknown;
    try {
      writeUserConfigValue("github.token", "ghp_TOPSECRET", {}, home);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UserConfigError);
    expect(error).toMatchObject({ code: "invalid_value", oclif: { exit: 2 } });
    expect((error as Error).message).toContain("github.token");
    expect((error as Error).message).not.toContain("ghp_TOPSECRET");
    expect(fs.existsSync(defaultFile())).toBe(false);
  });

  // §4: keys that are not file keys (not in the reader's accepted set).
  it.each([
    "has-called-config",
    "branchName",
    "jira.branchType",
    "nonsense",
  ])("refuses %s, which the file cannot hold", (key) => {
    expect(() => writeUserConfigValue(key, "x", {}, home)).toThrow(
      new RegExp(
        `${key.replace(".", "\\.")} cannot be set in the user config file`,
      ),
    );
    expect(fs.existsSync(defaultFile())).toBe(false);
  });

  it("refuses a value the reader would refuse, naming the key", () => {
    expect(() =>
      writeUserConfigValue("herdr.focus", "maybe", {}, home),
    ).toThrow("herdr.focus must be true or false");
    expect(() => writeUserConfigValue("opener", "emacs", {}, home)).toThrow(
      "Invalid value for opener",
    );
    expect(fs.existsSync(defaultFile())).toBe(false);
  });

  // D8: never overwrite a file that does not parse; name the parse error.
  it("leaves a file that does not parse untouched and names the error", () => {
    const broken = "opener: [auto\ncodeEditor: code\n";
    write(defaultFile(), broken);
    expect(() => writeUserConfigValue("codeEditor", "zed", {}, home)).toThrow(
      /not valid YAML, so it was left as it is: .*\. Fix it by hand/,
    );
    expect(text(defaultFile())).toBe(broken);
    expect(fs.readdirSync(path.dirname(defaultFile()))).toEqual(["config.yml"]);
  });

  it("leaves a file that is not a mapping untouched", () => {
    write(defaultFile(), "- a\n- b\n");
    expect(() => writeUserConfigValue("codeEditor", "zed", {}, home)).toThrow(
      "must be a mapping",
    );
    expect(text(defaultFile())).toBe("- a\n- b\n");
  });

  it("leaves a file untouched when the key's section is a plain value", () => {
    write(defaultFile(), "agent: claude\n");
    expect(() => writeUserConfigValue("agent.command", "x", {}, home)).toThrow(
      "agent is not a section",
    );
    expect(text(defaultFile())).toBe("agent: claude\n");
  });

  // §4: an equal value is a no-op; the file is not rewritten (same inode, same
  // mtime, and not even a comment-only or odd-spacing file is reformatted).
  it("rewrites nothing when the value is already there", () => {
    const odd = "codeEditor:   code   # keep my spacing\n";
    const file = write(defaultFile(), odd);
    fs.chmodSync(file, 0o644);
    const before = fs.statSync(file);
    const result = writeUserConfigValue("codeEditor", "code", {}, home);
    expect(result.changed).toBe(false);
    const after = fs.statSync(file);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(text(file)).toBe(odd);
    expect(mode(file)).toBe(0o644);
  });

  it("treats a boolean and a one-step list as equal to what they hold", () => {
    write(defaultFile(), "herdr:\n  focus: true\npostCreate:\n  - pnpm i\n");
    expect(writeUserConfigValue("herdr.focus", "true", {}, home).changed).toBe(
      false,
    );
    expect(writeUserConfigValue("postCreate", "pnpm i", {}, home).changed).toBe(
      false,
    );
  });

  // The replacement is a new 0600 file: a looser mode is tightened.
  it("gives an existing file mode 0600 when it is changed", () => {
    const file = write(defaultFile(), "opener: auto\n");
    fs.chmodSync(file, 0o644);
    writeUserConfigValue("opener", "none", {}, home);
    expect(mode(file)).toBe(0o600);
  });

  it("leaves no temp file behind and keeps an existing directory's mode", () => {
    write(defaultFile(), "opener: auto\n");
    fs.chmodSync(path.dirname(defaultFile()), 0o755);
    writeUserConfigValue("codeEditor", "code", {}, home);
    expect(fs.readdirSync(path.dirname(defaultFile()))).toEqual(["config.yml"]);
    expect(mode(path.dirname(defaultFile()))).toBe(0o755);
  });

  it("writes through a symlink instead of replacing it", () => {
    const real = write(
      path.join(dir, "dotfiles", "config.yml"),
      "opener: auto\n",
    );
    fs.mkdirSync(path.dirname(defaultFile()), { recursive: true });
    fs.symlinkSync(real, defaultFile());
    writeUserConfigValue("codeEditor", "code", {}, home);
    expect(fs.lstatSync(defaultFile()).isSymbolicLink()).toBe(true);
    expect(text(real)).toBe("opener: auto\ncodeEditor: code\n");
  });

  // D4: WORKTREE_USER_CONFIG names the file; it is created, with its directory.
  it("creates the file WORKTREE_USER_CONFIG names", () => {
    const target = path.join(dir, "elsewhere", "mine.yml");
    const result = writeUserConfigValue(
      "opener",
      "none",
      { WORKTREE_USER_CONFIG: target },
      home,
    );
    expect(result.path).toBe(target);
    expect(text(target)).toContain("opener: none\n");
  });

  // Reads after a write must see it: the cache is reset by the writer.
  it("makes the next loadUserConfig see the new value", async () => {
    const file = path.join(dir, "c.yml");
    vi.stubEnv("WORKTREE_USER_CONFIG", file);
    writeUserConfigValue("opener", "none");
    expect(await loadUserConfig()).toMatchObject({
      config: { opener: "none" },
    });
    writeUserConfigValue("opener", "rex");
    expect(await loadUserConfig()).toMatchObject({ config: { opener: "rex" } });
  });
});
