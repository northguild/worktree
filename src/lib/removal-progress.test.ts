import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRemovalWatcher,
  measureAbsentTree,
  measureTree,
} from "./removal-progress.js";

// Every read goes to the real readdir, so each case walks a real tree. The
// mock is there for the one case that needs a directory to be unreadable:
// a mode-000 directory is still readable to root, as in a CI container.
const fsMocks = vi.hoisted(() => ({ unreadable: new Set<string>() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readdirUnlessUnreadable = (async (
    ...args: Parameters<typeof actual.readdir>
  ) => {
    const [path] = args;
    if (fsMocks.unreadable.has(String(path))) {
      throw Object.assign(
        new Error(`EACCES: permission denied, scandir '${String(path)}'`),
        { code: "EACCES" },
      );
    }
    return actual.readdir(...args);
  }) as typeof actual.readdir;
  return { ...actual, readdir: readdirUnlessUnreadable };
});

/**
 * Builds a tree and counts the entries as it creates them, so every expected
 * number below is arithmetic over the fixture and never measureTree's output.
 */
class Fixture {
  readonly root = mkdtempSync(join(tmpdir(), "removal-progress-"));
  /** Entries created below the root: files, directories and symlinks. */
  entries = 0;

  directory(relativePath: string): string {
    mkdirSync(join(this.root, relativePath), { recursive: true });
    this.entries += 1;
    return join(this.root, relativePath);
  }

  files(relativeDirectory: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
      writeFileSync(
        join(this.root, relativeDirectory, `file-${index}.txt`),
        "x",
      );
      this.entries += 1;
    }
  }

  symlink(relativePath: string, target: string): void {
    symlinkSync(target, join(this.root, relativePath));
    this.entries += 1;
  }

  path(relativePath: string): string {
    return join(this.root, relativePath);
  }

  remove(relativePath: string): void {
    rmSync(join(this.root, relativePath), { recursive: true, force: true });
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/**
 * root/
 *   small/    1 dir + 3 files            = 4 entries
 *   medium/   1 dir + 2 files + inner/ (1 dir + 2 files) = 6 entries
 *   empty/    1 dir                      = 1 entry
 *   file-0.txt, file-1.txt                 = 2 entries
 * 13 entries in all.
 */
function buildFixture(): Fixture {
  const fixture = new Fixture();
  fixture.directory("small");
  fixture.files("small", 3);
  fixture.directory("medium");
  fixture.files("medium", 2);
  fixture.directory("medium/inner");
  fixture.files("medium/inner", 2);
  fixture.directory("empty");
  fixture.files(".", 2);
  return fixture;
}

describe("measureTree", () => {
  let fixture: Fixture;
  afterEach(() => fixture.dispose());

  it("counts every file and directory below the root, not the root", async () => {
    fixture = buildFixture();
    const measurement = await measureTree(fixture.root);
    expect(measurement.total).toBe(fixture.entries);
    expect(fixture.entries).toBe(13);
  });

  it("counts a symlink to a directory as one entry and does not enter it", async () => {
    fixture = buildFixture();
    const outside = new Fixture();
    try {
      outside.directory("target");
      outside.files("target", 5);
      fixture.symlink("link-to-dir", outside.path("target"));
      fixture.symlink("link-to-file", outside.path("target/file-0.txt"));
      const measurement = await measureTree(fixture.root);
      expect(measurement.total).toBe(fixture.entries);
      expect(fixture.entries).toBe(15);
    } finally {
      outside.dispose();
    }
  });

  it("throws when a directory cannot be read", async () => {
    fixture = buildFixture();
    const locked = fixture.directory("locked");
    fixture.files("locked", 1);
    fsMocks.unreadable.add(locked);
    try {
      await expect(measureTree(fixture.root)).rejects.toMatchObject({
        code: "EACCES",
      });
    } finally {
      fsMocks.unreadable.delete(locked);
    }
  });

  it("picks directories at or under the fraction as checkpoints, each with its subtree", async () => {
    fixture = buildFixture();
    // 13 entries * 0.4 = 5.2, so the threshold is 5: small (4), inner (3) and
    // empty (1) qualify; medium (6) does not.
    const measurement = await measureTree(fixture.root, {
      checkpointFraction: 0.4,
    });
    const byPath = new Map(
      measurement.checkpoints.map((checkpoint) => [
        checkpoint.path,
        checkpoint.entries,
      ]),
    );
    expect(byPath.get(fixture.path("small"))).toBe(4);
    expect(byPath.get(fixture.path("medium/inner"))).toBe(3);
    expect(byPath.get(fixture.path("empty"))).toBe(1);
    expect(byPath.has(fixture.path("medium"))).toBe(true);
    expect(byPath.get(fixture.path("medium"))).toBe(1);
  });

  it("covers every entry when each lies under some checkpoint", async () => {
    fixture = buildFixture();
    for (const options of [{}, { checkpointFraction: 0.4 }]) {
      const measurement = await measureTree(fixture.root, options);
      expect(measurement.coveredFraction).toBe(1);
    }
  });

  it("reports the tree as an absent worktree weighing one entry", () => {
    expect(measureAbsentTree()).toEqual({
      total: 1,
      checkpoints: [],
      coveredFraction: 0,
    });
  });
});

describe("createRemovalWatcher", () => {
  let fixture: Fixture;
  afterEach(() => fixture.dispose());

  it("starts at zero while nothing has been deleted", async () => {
    fixture = buildFixture();
    const watcher = createRemovalWatcher(
      await measureTree(fixture.root, { checkpointFraction: 0.4 }),
    );
    expect(watcher.countGone()).toBe(0);
  });

  it("adds each deleted checkpoint's subtree and nothing more", async () => {
    fixture = buildFixture();
    const watcher = createRemovalWatcher(
      await measureTree(fixture.root, { checkpointFraction: 0.4 }),
    );
    fixture.remove("small"); // 1 dir + 3 files
    expect(watcher.countGone()).toBe(4);
    fixture.remove("medium/inner"); // 1 dir + 2 files
    expect(watcher.countGone()).toBe(4 + 3);
    fixture.remove("empty");
    expect(watcher.countGone()).toBe(4 + 3 + 1);
  });

  it("counts the directly held files and directories outside any checkpoint", async () => {
    fixture = buildFixture();
    const watcher = createRemovalWatcher(
      await measureTree(fixture.root, { checkpointFraction: 0.4 }),
    );
    fixture.remove("file-0.txt");
    expect(watcher.countGone()).toBe(1);
    fixture.remove("medium/file-0.txt");
    expect(watcher.countGone()).toBe(2);
  });

  it("reaches the full total once everything is deleted", async () => {
    fixture = buildFixture();
    const measurement = await measureTree(fixture.root, {
      checkpointFraction: 0.4,
    });
    const watcher = createRemovalWatcher(measurement);
    for (const name of [
      "small",
      "medium",
      "empty",
      "file-0.txt",
      "file-1.txt",
    ]) {
      fixture.remove(name);
    }
    expect(watcher.countGone()).toBe(fixture.entries);
    expect(watcher.countGone()).toBe(13);
  });

  it("reaches the full total when only the checkpoints and sampled files are deleted", async () => {
    fixture = buildFixture();
    const measurement = await measureTree(fixture.root, {
      checkpointFraction: 0.4,
      maxSampledFiles: 2,
    });
    const watcher = createRemovalWatcher(measurement);
    for (const checkpoint of measurement.checkpoints) {
      rmSync(checkpoint.path, { recursive: true, force: true });
    }
    expect(watcher.countGone()).toBe(fixture.entries);
  });

  it("lets one sampled file stand for the whole group of files it was drawn from", async () => {
    fixture = new Fixture();
    fixture.directory("big");
    fixture.files("big", 10);
    fixture.directory("pad");
    fixture.files("pad", 20);
    // 32 entries, threshold 6, so big (11) and pad (21) are both too large and
    // their 30 files are sampled: ceil(30 / 6) = 5 files per sample, 6 samples.
    const measurement = await measureTree(fixture.root, {
      checkpointFraction: 0.2,
      maxSampledFiles: 6,
    });
    const groups = measurement.checkpoints.filter(
      (checkpoint) => checkpoint.entries === 5,
    );
    expect(groups).toHaveLength(6);

    const watcher = createRemovalWatcher(measurement);
    const [firstGroup] = groups;
    if (firstGroup === undefined) throw new Error("no sampled group");
    rmSync(firstGroup.path);
    expect(watcher.countGone()).toBe(5);
  });

  it("checks no more checkpoints per call than it is allowed", async () => {
    fixture = buildFixture();
    const measurement = await measureTree(fixture.root, {
      checkpointFraction: 0.4,
    });
    const [first, second] = measurement.checkpoints;
    if (first === undefined || second === undefined) {
      throw new Error("fewer than two checkpoints");
    }
    const watcher = createRemovalWatcher(measurement, { maxChecksPerPoll: 2 });
    fixture.dispose();
    expect(watcher.countGone()).toBe(first.entries + second.entries);
  });

  it("moves on to the checkpoints it has not checked, rather than rechecking the same ones", async () => {
    fixture = buildFixture();
    const measurement = await measureTree(fixture.root, {
      checkpointFraction: 0.4,
    });
    const [first, second, third, fourth] = measurement.checkpoints;
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw new Error("fewer than four checkpoints");
    }
    // Rechecking the first two would answer their sum, so it must differ.
    expect(third.entries + fourth.entries).not.toBe(
      first.entries + second.entries,
    );
    const watcher = createRemovalWatcher(measurement, { maxChecksPerPoll: 2 });
    expect(watcher.countGone()).toBe(0); // the first two, both still there
    fixture.dispose();
    expect(watcher.countGone()).toBe(third.entries + fourth.entries);
  });

  it("reaches the full total a few calls late when it checks a few at a time", async () => {
    fixture = buildFixture();
    const measurement = await measureTree(fixture.root, {
      checkpointFraction: 0.4,
    });
    const watcher = createRemovalWatcher(measurement, { maxChecksPerPoll: 2 });
    fixture.dispose();
    const calls = Math.ceil(measurement.checkpoints.length / 2);
    for (let call = 1; call < calls; call += 1) {
      expect(watcher.countGone()).toBeLessThan(fixture.entries);
    }
    expect(watcher.countGone()).toBe(fixture.entries);
    expect(watcher.countGone()).toBe(13);
  });

  it("never exceeds the total and never goes back down", async () => {
    fixture = buildFixture();
    const measurement = await measureTree(fixture.root, {
      checkpointFraction: 0.4,
    });
    const watcher = createRemovalWatcher(measurement);
    fixture.remove("small");
    const first = watcher.countGone();
    fixture.dispose();
    const last = watcher.countGone();
    expect(last).toBeGreaterThanOrEqual(first);
    expect(last).toBeLessThanOrEqual(fixture.entries);
  });
});
