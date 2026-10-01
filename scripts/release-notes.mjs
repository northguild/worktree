import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Returns the body of the `## <version>` section of a Changesets-generated CHANGELOG: the text under that
// heading up to the next `## ` heading (or the end of the file), trimmed. Returns null when the version
// has no section. `### ` sub-headings (Minor Changes, ...) belong to the body and do not end it.
export const extractReleaseNotes = (changelog, version) => {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === `## ${version}`);
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();

  return body === "" ? null : body;
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const [version, changelogPath = "CHANGELOG.md"] = process.argv.slice(2);

  if (!version) {
    console.error(
      "Usage: node scripts/release-notes.mjs <version> [CHANGELOG path]",
    );
    process.exit(2);
  }

  let changelog;
  try {
    changelog = await readFile(changelogPath, "utf8");
  } catch (error) {
    console.error(`Cannot read ${changelogPath}: ${error.message}`);
    process.exit(1);
  }

  const notes = extractReleaseNotes(changelog, version);
  if (notes === null) {
    console.error(
      `No release notes for version ${version} in ${changelogPath}. Run 'pnpm changeset:prepare-release' and commit its CHANGELOG.md.`,
    );
    process.exit(1);
  }

  process.stdout.write(`${notes}\n`);
}
