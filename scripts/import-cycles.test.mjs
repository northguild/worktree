import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Guard for context/standards/architecture/dependency-boundaries.md:81, "Circular dependencies are always
// forbidden". It walks the *runtime* import graph of non-test `src/` (#59, D3/D4): type-only imports are
// erased by tsc and cannot cause a temporal-dead-zone crash, so they are not edges.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Walk scope: every `.ts` file under `dir` except tests and the vitest setup file.
function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(path);
      const isSource =
        entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && entry.name !== "test-setup.ts";
      return isSource ? [path] : [];
    });
}

// Blank out comments, and the inside of string and template literals, keeping every character at its
// offset (newlines survive). Import-looking text in a comment or a string then cannot match, while the
// quotes stay put so a real specifier can still be read back from the original text at the same offsets.
// Known limit: a regex literal holding a quote, backtick or `/*` can confuse this. A stray ' or " ends
// at the newline, but a stray backtick runs to the next backtick and a stray `/*` to the next `*/`, so
// imports after one can be missed. That is harmless while imports stay at the top of every file. A template's `${}` expression is masked with the rest of it.
function mask(source) {
  const out = source.split(""); // UTF-16 units, so indices match `source`
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (char === '"' || char === "'" || char === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== char && (char === "`" || source[j] !== "\n")) {
        j += source[j] === "\\" ? 2 : 1;
      }
      for (let k = i + 1; k < Math.min(j, source.length); k++) if (out[k] !== "\n") out[k] = "_";
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

// `import|export <clause> from "<spec>"`. The clause grammar is spelled out (rather than "anything up to
// from") so `export class A {}` on one line cannot swallow an `import … from` on the next when a file has
// no semicolons. Groups: 1 keyword, 2 `type ` prefix, 3 clause, 4 quote, 5 masked specifier.
const CLAUSE = String.raw`(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\}|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)`;
const FROM = new RegExp(
  String.raw`(?<![\w$.])(import|export)(?![\w$])\s*(type\s+)?(${CLAUSE})\s*(?<![\w$])from\s*(["'])(_*)\4`,
  "g",
);
// `import "./x.js"`: no clause, still executes the module at load time, so it is a runtime edge.
const SIDE_EFFECT = /(?<![\w$.])import\s*(["'])(_*)\1/g;

// One specifier of a `{ … }` list is type-only when written `type X` or `type X as Y`. `type as foo`
// imports a value named `type`, and a lone `type` is a value too.
function isTypeSpecifier(specifier) {
  const words = specifier.trim().split(/\s+/);
  if (words[0] !== "type") return false;
  return words.length === 2 || words.length >= 4 || (words.length === 3 && words[1] !== "as");
}

// A statement is type-only when it is `import type …` / `export type …`, or when it holds only a braced
// list whose every specifier is `type`. A default or namespace binding, or an empty list (which can still
// load the module), keeps it a runtime edge.
function isTypeOnly({ typePrefix, clause }) {
  if (typePrefix) return true;
  const braced = clause.match(/^\s*\{([^}]*)\}\s*$/);
  if (!braced) return false;
  const specifiers = braced[1].split(",").filter((part) => part.trim() !== "");
  return specifiers.length > 0 && specifiers.every(isTypeSpecifier);
}

// Dynamic `import("./x.js")` is deliberately not an edge: it runs when called, not when the module loads,
// so it cannot produce the load-time temporal-dead-zone crash this guard exists for. Neither regex above
// matches it (they need a quote straight after `import`, or a clause and `from`).
function runtimeSpecifiers(source) {
  const masked = mask(source);
  const read = (match, quoteIndex, length) => source.slice(quoteIndex + 1, quoteIndex + 1 + length);
  const found = [];
  for (const match of masked.matchAll(FROM)) {
    if (isTypeOnly({ typePrefix: match[2], clause: match[3] })) continue;
    const specLength = match[5].length;
    const quoteIndex = match.index + match[0].length - specLength - 2;
    found.push({ at: match.index, specifier: read(match, quoteIndex, specLength) });
  }
  for (const match of masked.matchAll(SIDE_EFFECT)) {
    const specLength = match[2].length;
    found.push({ at: match.index, specifier: read(match, match.index + match[0].length - specLength - 2, specLength) });
  }
  return found.sort((a, b) => a.at - b.at).map(({ specifier }) => specifier);
}

// Relative `.js` specifiers resolve to the `.ts` file beside them, as the build does. Anything else
// (packages, `node:`, JSON) is outside the graph, as is a target that is not a scanned file.
function resolveEdge(from, specifier, known) {
  if (!specifier.startsWith(".") || !specifier.endsWith(".js")) return undefined;
  const target = resolve(dirname(from), `${specifier.slice(0, -3)}.ts`);
  return known.has(target) ? target : undefined;
}

// Depth-first search with a colour map: white = unvisited, grey = on the current path, black = done.
// An edge into a grey file closes a cycle, which is read straight off the path. Files and edges are
// visited in sorted / source order, so the output is deterministic.
function findCycles(srcDir) {
  const files = listSourceFiles(srcDir);
  const known = new Set(files);
  const edges = new Map(
    files.map((file) => [
      file,
      runtimeSpecifiers(readFileSync(file, "utf8")).flatMap((specifier) => {
        const target = resolveEdge(file, specifier, known);
        return target ? [target] : [];
      }),
    ]),
  );
  const colour = new Map();
  const path = [];
  const cycles = [];
  const visit = (file) => {
    colour.set(file, "grey");
    path.push(file);
    for (const target of edges.get(file)) {
      if (colour.get(target) === "grey") {
        cycles.push([...path.slice(path.indexOf(target)), target]);
      } else if (!colour.has(target)) {
        visit(target);
      }
    }
    path.pop();
    colour.set(file, "black");
  };
  for (const file of files) if (!colour.has(file)) visit(file);
  return { files, cycles: cycles.map((cycle) => cycle.map((file) => relative(srcDir, file)).join(" -> ")) };
}

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Writes `{ "a.ts": "…" }` into a fresh temporary directory (removed after each test) and scans it.
function scanFixture(fileContents) {
  const dir = mkdtempSync(join(tmpdir(), "import-cycles-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(fileContents)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return findCycles(dir).cycles;
}

describe("runtime import cycles", () => {
  it("finds none in non-test src/", () => {
    const { files, cycles } = findCycles(join(root, "src"));
    // Guard the guard: an empty walk would pass on anything.
    expect(files.map((file) => relative(join(root, "src"), file))).toContain("lib/git.ts");
    expect(
      cycles,
      `Runtime import cycle in src/ (dependency-boundaries.md: circular dependencies are always forbidden). ` +
        `Move the shared symbol into a module both sides can import:\n  ${cycles.join("\n  ")}`,
    ).toEqual([]);
  });
});

// The fixture cycles below are written out by hand, never derived from findCycles, so a regex that stops
// matching shows up as a missing cycle instead of agreeing with itself.
describe("the cycle walk, on fixtures", () => {
  it("reports a two-file cycle", () => {
    expect(
      scanFixture({
        "a.ts": 'import { b } from "./b.js";\nexport const a = () => b;\n',
        "b.ts": 'import { a } from "./a.js";\nexport const b = () => a;\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("reports a three-file cycle", () => {
    expect(
      scanFixture({
        "a.ts": 'import { b } from "./b.js";\nexport const a = b;\n',
        "b.ts": 'import { c } from "./c.js";\nexport const b = c;\n',
        "c.ts": 'import { a } from "./a.js";\nexport const c = a;\n',
      }),
    ).toEqual(["a.ts -> b.ts -> c.ts -> a.ts"]);
  });

  it("reports a cycle through a multi-line import", () => {
    expect(
      scanFixture({
        "a.ts": 'import {\n  one,\n  two,\n} from "./b.js";\nexport const a = one + two;\n',
        "b.ts": 'import { a } from "./a.js";\nexport const one = a;\nexport const two = a;\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("reports a cycle through an `export … from` re-export", () => {
    expect(
      scanFixture({
        "a.ts": 'export { b } from "./b.js";\n',
        "b.ts": 'import { a } from "./a.js";\nexport const b = a;\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("reports a cycle through `export * from` and `export * as ns from`", () => {
    expect(
      scanFixture({
        "a.ts": 'export * from "./b.js";\n',
        "b.ts": 'export * as a from "./a.js";\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("reports a cycle through a side-effect import", () => {
    expect(
      scanFixture({
        "a.ts": 'import "./b.js";\n',
        "b.ts": "import './a.js';\n",
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("reports a cycle between files in different directories", () => {
    expect(
      scanFixture({
        "lib/a.ts": 'import { b } from "../commands/b.js";\nexport const a = b;\n',
        "commands/b.ts": 'import { a } from "../lib/a.js";\nexport const b = a;\n',
      }),
    ).toEqual(["commands/b.ts -> lib/a.ts -> commands/b.ts"]);
  });

  it("reports a cycle in a file without semicolons", () => {
    expect(
      scanFixture({
        "a.ts": 'export class A {}\nimport { b } from "./b.js"\nexport const a = b\n',
        "b.ts": 'import { a } from "./a.js"\nexport const b = a\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("ignores a cycle made only of `import type`", () => {
    expect(
      scanFixture({
        "a.ts": 'import type { B } from "./b.js";\nexport type A = B;\n',
        "b.ts": 'import type { A } from "./a.js";\nexport type B = A;\n',
      }),
    ).toEqual([]);
  });

  it("ignores `export type … from` and `import type X from`", () => {
    expect(
      scanFixture({
        "a.ts": 'export type { B } from "./b.js";\nexport type * from "./b.js";\nimport type D from "./b.js";\n',
        "b.ts": 'import { a } from "./a.js";\nexport type B = 1;\nexport const b = a;\n',
      }),
    ).toEqual([]);
  });

  it("treats a specifier list where every name is `type` as type-only", () => {
    expect(
      scanFixture({
        "a.ts": 'import { type B, type C as D } from "./b.js";\nexport type A = B | D;\n',
        "b.ts": 'import { a } from "./a.js";\nexport type B = 1;\nexport type C = 2;\nexport const b = a;\n',
      }),
    ).toEqual([]);
  });

  it("treats a specifier list mixing `type` and value names as a runtime edge", () => {
    expect(
      scanFixture({
        "a.ts": 'import { type B, c } from "./b.js";\nexport const a = c;\n',
        "b.ts": 'import { a } from "./a.js";\nexport type B = 1;\nexport const c = a;\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("treats a default binding next to type names, and a value called `type`, as runtime edges", () => {
    expect(
      scanFixture({
        "a.ts": 'import d, { type B } from "./b.js";\nexport const a = d;\n',
        "b.ts": 'import { type as t } from "./c.js";\nexport type B = 1;\nexport default t;\n',
        "c.ts": 'import { a } from "./a.js";\nexport const type = a;\n',
      }),
    ).toEqual(["a.ts -> b.ts -> c.ts -> a.ts"]);
  });

  it("does not count a dynamic import(): it runs when called, not when the module loads", () => {
    expect(
      scanFixture({
        "a.ts": 'export const a = () => import("./b.js");\n',
        "b.ts": 'import { a } from "./a.js";\nexport const b = a;\n',
      }),
    ).toEqual([]);
  });

  it("ignores import-looking text in comments and strings", () => {
    expect(
      scanFixture({
        "a.ts": [
          '// import { b } from "./b.js";',
          '/* import { b } from "./b.js";',
          '   export * from "./b.js"; */',
          "export const note = 'import { b } from \"./b.js\"';",
          "export const doc = `",
          'import { b } from "./b.js";',
          "`;",
          "",
        ].join("\n"),
        "b.ts": 'import { a } from "./a.js";\nexport const b = a;\n',
      }),
    ).toEqual([]);
  });

  it("still reads a real import that follows a comment containing a quote", () => {
    expect(
      scanFixture({
        "a.ts": '// it\'s a comment with a quote\nimport { b } from "./b.js";\nexport const a = b;\n',
        "b.ts": 'import { a } from "./a.js";\nexport const b = a;\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("leaves test files, test-setup.ts and non-relative specifiers out of the graph", () => {
    // Each exclusion is the only thing preventing a cycle: a.test.ts and test-setup.ts import ./a.js, and
    // a.ts imports them back. "b.js" (bare) would resolve to ./b.ts, which imports ./a.js, if not skipped.
    expect(
      scanFixture({
        "a.ts": 'import "b.js";\nimport "./a.test.js";\nimport "./test-setup.js";\nexport const a = 1;\n',
        "b.ts": 'import { a } from "./a.js";\nexport const b = a;\n',
        "a.test.ts": 'import { a } from "./a.js";\nexport const t = a;\n',
        "test-setup.ts": 'import { a } from "./a.js";\nexport const s = a;\n',
      }),
    ).toEqual([]);
  });

  it("reads imports that follow an astral character (emoji) in a comment or string", () => {
    expect(
      scanFixture({
        "a.ts": '// \u{1F389} shipped\nimport { b } from "./b.js";\nexport const a = b;\n',
        "b.ts": 'export const note = "\u{1F389}";\nexport { a } from "./a.js";\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts"]);
  });

  it("reports every cycle, not just the first", () => {
    expect(
      scanFixture({
        "a.ts": 'import { b } from "./b.js";\nexport const a = b;\n',
        "b.ts": 'import { a } from "./a.js";\nexport const b = a;\n',
        "c.ts": 'import { d } from "./d.js";\nexport const c = d;\n',
        "d.ts": 'import { c } from "./c.js";\nexport const d = c;\n',
      }),
    ).toEqual(["a.ts -> b.ts -> a.ts", "c.ts -> d.ts -> c.ts"]);
  });
});
