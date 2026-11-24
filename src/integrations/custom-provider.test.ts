import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProcessRunning, KILL_GRACE_MS } from "../lib/cli.js";
import { InvalidValueError } from "../lib/prompt.js";
import {
  assignCustomIssue,
  fetchCustomIssue,
  startCustomIssue,
} from "./custom-provider.js";

// src/test-setup.ts mocks ../lib/cli.js for every suite so command tests never
// execute anything. The runner is the subject here, so it opts back out and
// drives a real child process.
vi.unmock("../lib/cli.js");

const node = process.execPath;
const NAME = "verk";

// The stand-in provider is written into a temp directory, one script per case:
// it is a program the runner executes, not a module of this package, and none
// of it ships under src/.
let dir: string;
let scripts = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "worktree-provider-"));
});

afterAll(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The argv of a stand-in provider whose whole program is `body`. */
function provider(body: string): string[] {
  scripts += 1;
  const file = join(dir, `provider-${scripts}.mjs`);
  writeFileSync(file, body);
  return [node, file];
}

/** A provider that prints `document` as its answer. */
function printing(document: unknown, { raw = false } = {}): string[] {
  const text = raw ? String(document) : JSON.stringify(document);
  return provider(`process.stdout.write(${JSON.stringify(text)});`);
}

// The version-1 fetch answer of the contract (plan §4.2), field for field.
function issue(overrides: Record<string, unknown> = {}) {
  return {
    key: "VERK-42",
    title: "Fix login",
    url: "https://verk.example/i/42",
    type: "Bug",
    labels: ["auth"],
    fields: [],
    kind: "bugfix",
    can: ["assign", "start"],
    ...overrides,
  };
}

function answer(overrides: Record<string, unknown> = {}) {
  return { version: 1, issue: issue(overrides) };
}

function fetching(argv: string[], reference = "VERK-42", timeout?: number) {
  return fetchCustomIssue(argv, reference, {
    name: NAME,
    cwd: dir,
    ...(timeout === undefined ? {} : { timeoutMs: timeout }),
  });
}

describe("a valid answer", () => {
  it("is parsed into the issue the provider described", async () => {
    // Expected values are the contract's own example (plan §4.2), not read
    // back from the parser.
    await expect(fetching(printing(answer()))).resolves.toEqual({
      key: "VERK-42",
      title: "Fix login",
      url: "https://verk.example/i/42",
      type: "Bug",
      labels: ["auth"],
      fields: [],
      kind: "bugfix",
      can: ["assign", "start"],
    });
  });

  it("carries extra fields in the shape the rules engine compares (D7)", async () => {
    const fields = [
      { id: "sev", name: "Severity", values: [{ id: "1", name: "High" }] },
    ];

    const result = await fetching(printing(answer({ fields })));

    expect(result.fields).toEqual(fields);
  });

  it("defaults what the provider leaves out: no url, type, labels, fields, kind or abilities", async () => {
    const result = await fetching(
      printing({ version: 1, issue: { key: "VERK-1", title: "T" } }),
    );

    expect(result).toEqual({
      key: "VERK-1",
      title: "T",
      url: null,
      type: null,
      labels: [],
      fields: [],
      kind: null,
      can: [],
    });
  });

  it("accepts a null url and a null kind", async () => {
    const result = await fetching(
      printing(answer({ url: null, kind: null, type: null })),
    );

    expect(result).toMatchObject({ url: null, kind: null, type: null });
  });

  it("accepts a title with control characters, which only reaches the slug", async () => {
    const result = await fetching(printing(answer({ title: "a\u001b[31mb" })));

    expect(result.title).toBe("a\u001b[31mb");
  });

  it("runs the command in the directory it is given", async () => {
    const argv = provider(
      `process.stdout.write(JSON.stringify({version:1,issue:{key:"K-1",title:process.cwd()}}));`,
    );

    const result = await fetchCustomIssue(argv, "K-1", {
      name: NAME,
      cwd: dir,
    });

    // macOS reports the temp directory through a symlink; compare the tail.
    expect(result.title.endsWith(dir.split("/").pop() ?? "")).toBe(true);
  });
});

describe("the request", () => {
  // D2: one JSON document on stdin, argv exactly what was configured. A
  // reference that starts with `-` would be read as an option by the provider's
  // own parser had it been appended to argv.
  it("reaches the provider as one JSON document on stdin, a leading dash intact", async () => {
    const argv = provider(`
      let stdin = "";
      process.stdin.on("data", (chunk) => (stdin += chunk)).on("end", () => {
        const seen = JSON.stringify({ stdin, argv: process.argv.slice(2) });
        process.stdout.write(JSON.stringify({ version: 1, issue: { key: "K-1", title: seen } }));
      });
    `);

    const result = await fetching(argv, "--output=/etc/passwd");
    const seen = JSON.parse(result.title);

    expect(JSON.parse(seen.stdin)).toEqual({
      version: 1,
      operation: "fetch",
      reference: "--output=/etc/passwd",
    });
    expect(seen.argv).toEqual([]);
    expect(argv).not.toContain("--output=/etc/passwd");
  });
});

describe("what is refused at the boundary (D6)", () => {
  async function refusal(argv: string[]) {
    const error = await fetching(argv).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  it.each([
    ["a missing version", { issue: issue() }],
    ["an unknown version", { version: 2, issue: issue() }],
    ["a version that is a string", { version: "1", issue: issue() }],
  ])("%s, naming the provider", async (_label, document) => {
    const error = await refusal(printing(document));

    expect(error.message).toMatch(/^verk: /);
    expect(error.message).toContain("version");
    expect(error).not.toBeInstanceOf(InvalidValueError);
  });

  it.each([
    ["an empty key", "", /key/],
    ["a key with a slash", "a/b", /key/],
    ["a key with a dot", "a.b", /key/],
    ["a key with a space", "a b", /key/],
    ["a key starting with a dash", "-a", /key/],
    ["a key ending with a dash", "a-", /key/],
    ["a key with a double dash", "a--b", /key/],
    ["a key with a control character", "A-1\u0007", /key/],
    ["a key of 65 characters", "a".repeat(65), /key/],
  ])("%s", async (_label, key, where) => {
    const error = await refusal(printing(answer({ key })));

    expect(error.message).toMatch(/^verk: /);
    expect(error.message).toMatch(where);
  });

  it("accepts a key of exactly 64 characters, and underscores between segments", async () => {
    const key = `${"a".repeat(31)}_${"b".repeat(32)}`;
    expect(key).toHaveLength(64);

    const result = await fetching(printing(answer({ key })));

    expect(result.key).toBe(key);
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://verk.example/i/1",
    "not a url",
    "",
  ])("a url that is not http or https: %j", async (url) => {
    const error = await refusal(printing(answer({ url })));

    expect(error.message).toMatch(/^verk: /);
    expect(error.message).toContain("url");
  });

  it.each([
    ["type", { type: "Bug\u001b[2J" }],
    ["a label", { labels: ["ok", "bad‮"] }],
    ["a field id", { fields: [{ id: "a\u0000", name: "n", values: [] }] }],
    ["a field name", { fields: [{ id: "a", name: "n\r", values: [] }] }],
    [
      "a field value",
      { fields: [{ id: "a", name: "n", values: [{ name: "v​" }] }] },
    ],
    ["the url", { url: "https://verk.example/\u0007" }],
  ])("a control or formatting character in %s", async (_label, overrides) => {
    const error = await refusal(printing(answer(overrides)));

    expect(error.message).toMatch(/^verk: /);
  });

  it("a kind outside feature, bugfix and chore", async () => {
    const error = await refusal(printing(answer({ kind: "epic" })));

    expect(error.message).toContain("kind");
  });

  it("a key the contract does not name, because the schema is strict", async () => {
    const error = await refusal(printing(answer({ assignee: "ada" })));

    expect(error.message).toMatch(/^verk: /);
  });

  it("an unknown top-level key", async () => {
    const error = await refusal(printing({ ...answer(), extra: true }));

    expect(error.message).toMatch(/^verk: /);
  });

  it("output that is not JSON", async () => {
    const error = await refusal(printing("hello", { raw: true }));

    expect(error.message).toMatch(/^verk: .*JSON/);
  });

  it("JSON that is not an object", async () => {
    const error = await refusal(printing("[1]", { raw: true }));

    expect(error.message).toMatch(/^verk: /);
  });

  it("stdout over 1 MiB, ending the provider", async () => {
    const argv = provider(
      `process.stdout.write("a".repeat(2 * 1024 * 1024)); setTimeout(() => {}, 600_000);`,
    );

    const error = await refusal(argv);

    expect(error.message).toMatch(/^verk: .*1 MiB on standard output\.$/);
  });

  it("stderr over 1 MiB, ending the provider and naming standard error", async () => {
    // Node's maxBuffer bounds each stream on its own, so the cap holds for
    // stderr too; the message names the stream so its author looks there.
    const argv = provider(
      `process.stderr.write("e".repeat(2 * 1024 * 1024)); setTimeout(() => {}, 600_000);`,
    );

    const error = await refusal(argv);

    expect(error.message).toMatch(/^verk: .*1 MiB on standard error\.$/);
  });

  it("does not show the provider's own bytes in the refusal of a bad key", async () => {
    const error = await refusal(printing(answer({ key: "x\u001b[2Jy/" })));

    expect(error.message.includes("\u001b")).toBe(false);
  });
});

describe("an error the provider reports (D6)", () => {
  function failing(code: string, message = "No issue VERK-42.") {
    return printing({ version: 1, error: { code, message } });
  }

  it("maps invalid_reference to an invalid value, exit 2", async () => {
    const error = await fetching(
      failing("invalid_reference", "Not a Verk key."),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidValueError);
    expect((error as InvalidValueError).message).toBe("verk: Not a Verk key.");
    expect((error as InvalidValueError).oclif).toEqual({ exit: 2 });
  });

  it.each([
    "not_found",
    "failed",
  ])("maps %s to a plain failure, exit 1, with the provider's message", async (code) => {
    const error = await fetching(failing(code)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InvalidValueError);
    expect((error as Error).message).toBe("verk: No issue VERK-42.");
    expect((error as { oclif?: unknown }).oclif).toBeUndefined();
  });

  it("honours the error document when the provider also exits non-zero", async () => {
    const argv = provider(
      `process.stdout.write(JSON.stringify({version:1,error:{code:"not_found",message:"gone"}})); process.exit(1);`,
    );

    await expect(fetching(argv)).rejects.toThrow("verk: gone");
  });

  it("reports failed, never timeout, for a provider message that reads like a timeout", async () => {
    // base-command.ts maps a message matching "did not answer within <n>s" to
    // `timeout` unless the error names its own code.
    const error = await fetching(
      failing("failed", "Verk API did not answer within 30s"),
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: "verk: Verk API did not answer within 30s",
      code: "failed",
    });
  });

  it("refuses an error code the contract does not name", async () => {
    await expect(fetching(failing("exploded"))).rejects.toThrow(/^verk: /);
  });

  it("shows the provider's message visibly and without a secret", async () => {
    const message = `bad\u001b[2J ghp_${"a".repeat(30)}`;

    const error = await fetching(failing("failed", message)).catch(
      (caught: unknown) => caught as Error,
    );

    expect((error as Error).message).toBe("verk: bad\\x1b[2J ***");
  });
});

describe("a provider that fails without a valid document", () => {
  it("is a failure naming issueProvider.command, with the exit code", async () => {
    const argv = provider("process.exit(3);");

    const error = await fetching(argv).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InvalidValueError);
    expect((error as Error).message).toMatch(
      /^verk: .*issueProvider\.command.*3/,
    );
  });

  it("is a failure even when stdout holds a valid answer", async () => {
    const argv = provider(
      `process.stdout.write(${JSON.stringify(JSON.stringify(answer()))}); process.exit(1);`,
    );

    await expect(fetching(argv)).rejects.toThrow(/^verk: .*exit/);
  });

  it("shows the last non-empty line of stderr, on failure only", async () => {
    const argv = provider(
      `process.stderr.write("noise\\nconnecting\\nHTTP 500 from upstream\\n\\n"); process.exit(1);`,
    );

    await expect(fetching(argv)).rejects.toThrow(/HTTP 500 from upstream/);
  });

  it("does not show earlier stderr lines", async () => {
    const argv = provider(
      `process.stderr.write("secret-looking first line\\nlast line\\n"); process.exit(1);`,
    );

    const error = await fetching(argv).catch((caught: unknown) => caught);

    expect((error as Error).message).not.toContain("first line");
  });

  it("redacts a token-shaped string in stderr", async () => {
    const token = `ghp_${"A1b2C3d4E5".repeat(3)}`;
    const argv = provider(
      `process.stderr.write("auth failed with ${token}\\n"); process.exit(1);`,
    );

    const error = (await fetching(argv).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toContain("auth failed with ***");
    expect(error.message).not.toContain(token);
  });

  it("escapes control characters in stderr", async () => {
    const argv = provider(
      `process.stderr.write("a\\u001b[2Jb\\n"); process.exit(1);`,
    );

    const error = (await fetching(argv).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toContain("a\\x1b[2Jb");
    expect(error.message.includes("\u001b")).toBe(false);
  });

  it("cuts stderr to 200 characters", async () => {
    const argv = provider(
      `process.stderr.write("e".repeat(500) + "\\n"); process.exit(1);`,
    );

    const error = (await fetching(argv).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toContain("e".repeat(200));
    expect(error.message).not.toContain("e".repeat(201));
  });

  it("shows stderr when the answer is malformed too", async () => {
    const argv = provider(
      `process.stderr.write("deprecated flag\\n"); process.stdout.write("oops");`,
    );

    await expect(fetching(argv)).rejects.toThrow(/deprecated flag/);
  });

  it("reports failed for stderr that ends with a timeout-shaped line", async () => {
    const argv = provider(
      `process.stderr.write("upstream did not answer within 30s\\n"); process.exit(1);`,
    );

    const error = await fetching(argv).catch((caught: unknown) => caught);

    expect((error as Error).message).toContain("did not answer within 30s");
    expect(error).toMatchObject({ code: "failed" });
  });

  it("says a provider killed by a signal was stopped, not that it could not be run", async () => {
    const argv = provider(`process.kill(process.pid, "SIGKILL");`);

    const error = (await fetching(argv).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toBe(
      "verk: the issue provider was stopped by SIGKILL before it answered.",
    );
    expect(error).toMatchObject({ code: "failed" });
    // Node's "Command failed: <argv>" would print the command line.
    expect(error.message).not.toContain(argv[1] as string);
  });

  it("does not show stderr when the answer is good", async () => {
    const argv = provider(
      `process.stderr.write("just a warning\\n"); process.stdout.write(${JSON.stringify(JSON.stringify(answer()))});`,
    );

    await expect(fetching(argv)).resolves.toMatchObject({ key: "VERK-42" });
  });

  it("is a failure naming issueProvider.command when the program cannot be run", async () => {
    const error = await fetching([
      "northguild-worktree-no-such-provider",
    ]).catch((caught: unknown) => caught);

    expect((error as Error).message).toMatch(/^verk: .*issueProvider\.command/);
    expect(error).not.toBeInstanceOf(InvalidValueError);
  });

  it("is a failure naming issueProvider.command for an empty command", async () => {
    await expect(fetching([])).rejects.toThrow(/issueProvider\.command/);
  });
});

describe("the time bound (D6)", () => {
  afterEach(() => {
    vi.doUnmock("../lib/cli.js");
    vi.resetModules();
  });

  const ignoreTerm = (pidFile: string) =>
    `import { writeFileSync } from "node:fs";
     writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
     process.on("SIGTERM", () => {});
     setTimeout(() => {}, 600_000);`;

  it("rejects a provider that sleeps past the bound as a timeout, by its code", async () => {
    const argv = provider(`setTimeout(() => {}, 600_000);`);

    const error = (await fetching(argv, "K-1", 1_000).catch(
      (caught: unknown) => caught,
    )) as Error;

    // The exact sentence D6 writes (here for a 1s bound, so `1s`, not `15s`),
    // and the code base-command.ts reports before it reads any message.
    expect(error.message).toBe(
      "verk: the issue provider did not answer within 1s.",
    );
    expect(error).toMatchObject({ code: "timeout" });
  });

  it("bounds every call at 15 s and 1 MiB when the caller names no timeout", async () => {
    // The file-level unmock hands this suite the real runner; this case wants
    // the global mock (src/test-setup.ts) so nothing runs and the call's
    // options can be read.
    vi.resetModules();
    vi.doMock("../lib/cli.js", () => ({ runCapturing: mockRunCapturing }));
    const mockRunCapturing = vi.fn().mockResolvedValue({
      stdout: JSON.stringify(answer()),
      stderr: "",
      exitCode: 0,
    });
    const { fetchCustomIssue: fetchWithMock } = await import(
      "./custom-provider.js"
    );

    await fetchWithMock(["provider"], "K-1", { name: NAME });

    expect(mockRunCapturing).toHaveBeenCalledWith(
      "provider",
      [],
      expect.objectContaining({ timeout: 15_000, maxBuffer: 1_048_576 }),
    );
  });

  it("says 15s for a 15 000 ms bound", async () => {
    vi.resetModules();
    const killed = Object.assign(new Error("killed"), { killed: true });
    vi.doMock("../lib/cli.js", () => ({
      runCapturing: vi.fn().mockRejectedValue(killed),
    }));
    const { fetchCustomIssue: fetchWithMock } = await import(
      "./custom-provider.js"
    );

    await expect(
      fetchWithMock(["provider"], "K-1", { name: NAME }),
    ).rejects.toThrow("verk: the issue provider did not answer within 15s.");
  });

  it("reports a provider whose SIGTERM handler exits 1 as a timeout", async () => {
    const argv = provider(
      `process.on("SIGTERM", () => process.exit(1)); setTimeout(() => {}, 600_000);`,
    );

    await expect(fetching(argv, "K-1", 1_000)).rejects.toThrow(
      "verk: the issue provider did not answer within 1s.",
    );
  });

  it(
    "kills a provider that ignores SIGTERM, with SIGKILL after the grace period",
    async () => {
      const pidFile = join(dir, "sigterm-ignorer.pid");
      const argv = provider(ignoreTerm(pidFile));

      await expect(fetching(argv, "K-1", 1_000)).rejects.toThrow(
        /did not answer within 1s/,
      );

      const pid = Number(readFileSync(pidFile, "utf8"));
      expect(pid).toBeGreaterThan(0);
      // The rejection waits for the child's exit, so by now it is gone.
      expect(isProcessRunning(pid)).toBe(false);
    },
    1_000 + KILL_GRACE_MS + 5_000,
  );
});

// #357 Phase 5: the two optional operations (D8). The expected answers are the
// contract's own (plan §4.2: `{"version":1,"outcome":"held-by-other",
// "heldBy":"Ada"}`) and D8's outcome sets, not read back from the parser. Both
// go through the runner `fetchCustomIssue` uses, so the bound, the error
// mapping and the stderr rules are asserted once for the runner (above) and the
// paths below only show that the new operations reach them.
function operating(
  call: typeof assignCustomIssue | typeof startCustomIssue,
  argv: string[],
  timeoutMs?: number,
) {
  return call(argv, "VERK-42", {
    name: NAME,
    cwd: dir,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

const operations = [
  ["assign", assignCustomIssue],
  ["start", startCustomIssue],
] as const;

describe.each(operations)("the %s operation", (operation, call) => {
  it("reaches the provider as one JSON document with the key, argv untouched", async () => {
    // The provider echoes its stdin on stderr and fails, which is the one
    // channel the failure message shows; the expected document is the
    // contract's (plan §4.2), field for field.
    const echo = provider(`
      let stdin = "";
      process.stdin.on("data", (chunk) => (stdin += chunk)).on("end", () => {
        process.stderr.write(stdin + JSON.stringify(process.argv.slice(2)));
        process.exit(3);
      });
    `);

    const error = (await operating(call, echo).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toContain(
      `{"version":1,"operation":"${operation}","key":"VERK-42"}[]`,
    );
  });

  it("is refused when the answer is a fetch answer, not an outcome", async () => {
    const error = (await operating(call, printing(answer())).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toContain(
      "verk: the issue provider's answer is not valid",
    );
  });

  it("maps the provider's invalid_reference to an invalid value, exit 2", async () => {
    const argv = printing({
      version: 1,
      error: { code: "invalid_reference", message: "Not a key." },
    });

    await expect(operating(call, argv)).rejects.toBeInstanceOf(
      InvalidValueError,
    );
  });

  it("is a failure naming issueProvider.command when the provider exits non-zero", async () => {
    const argv = provider(`process.exit(4);`);

    await expect(operating(call, argv)).rejects.toThrow(
      "verk: issueProvider.command exited with code 4.",
    );
  });

  it("times out with the sentence base-command.ts maps to a timeout", async () => {
    const argv = provider(`setTimeout(() => {}, 600_000);`);

    await expect(operating(call, argv, 1_000)).rejects.toThrow(
      "verk: the issue provider did not answer within 1s.",
    );
  });

  it("refuses an outcome the contract does not name", async () => {
    const argv = printing({ version: 1, outcome: "done" });

    await expect(operating(call, argv)).rejects.toThrow(
      "verk: the issue provider's answer is not valid",
    );
  });
});

describe("the assign outcomes (D8)", () => {
  it.each(["assigned", "already-yours"])("returns %s", async (outcome) => {
    await expect(
      operating(assignCustomIssue, printing({ version: 1, outcome })),
    ).resolves.toEqual({ outcome });
  });

  it("returns held-by-other with who holds it", async () => {
    await expect(
      operating(
        assignCustomIssue,
        printing({ version: 1, outcome: "held-by-other", heldBy: "Ada" }),
      ),
    ).resolves.toEqual({ outcome: "held-by-other", heldBy: "Ada" });
  });

  it("returns held-by-other without a name when the provider gave none", async () => {
    await expect(
      operating(
        assignCustomIssue,
        printing({ version: 1, outcome: "held-by-other" }),
      ),
    ).resolves.toEqual({ outcome: "held-by-other" });
  });

  it("refuses a start outcome", async () => {
    await expect(
      operating(
        assignCustomIssue,
        printing({ version: 1, outcome: "already-started", state: "Doing" }),
      ),
    ).rejects.toThrow("answer is not valid");
  });

  it("refuses a heldBy with a control character, because every string but title does (D6)", async () => {
    await expect(
      operating(
        assignCustomIssue,
        printing({
          version: 1,
          outcome: "held-by-other",
          heldBy: "Ada\u001b[2J",
        }),
      ),
    ).rejects.toThrow("answer is not valid");
  });

  it("refuses a field the contract does not name, because the schema is strict", async () => {
    await expect(
      operating(
        assignCustomIssue,
        printing({ version: 1, outcome: "assigned", extra: 1 }),
      ),
    ).rejects.toThrow("answer is not valid");
  });
});

describe("the start outcomes (D8)", () => {
  it("returns started with where it moved from and to", async () => {
    await expect(
      operating(
        startCustomIssue,
        printing({ version: 1, outcome: "started", from: "Todo", to: "Doing" }),
      ),
    ).resolves.toEqual({ outcome: "started", from: "Todo", to: "Doing" });
  });

  it.each([
    "already-started",
    "left-alone",
  ])("returns %s with the state it is in", async (outcome) => {
    await expect(
      operating(
        startCustomIssue,
        printing({ version: 1, outcome, state: "Review" }),
      ),
    ).resolves.toEqual({ outcome, state: "Review" });
  });

  it.each([
    ["started with no from or to", { outcome: "started" }],
    ["already-started with no state", { outcome: "already-started" }],
    ["left-alone with no state", { outcome: "left-alone" }],
    ["an assign outcome", { outcome: "assigned" }],
  ])("refuses %s", async (_label, body) => {
    await expect(
      operating(startCustomIssue, printing({ version: 1, ...body })),
    ).rejects.toThrow("answer is not valid");
  });
});
