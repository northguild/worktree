import { readFile, writeFile } from "node:fs/promises";

const rootPackagePath = new URL("../package.json", import.meta.url);
const docsSiteMetaFilePath = new URL(
  "../docs/src/lib/site-meta.ts",
  import.meta.url,
);

const rootPackage = JSON.parse(await readFile(rootPackagePath, "utf8"));

const rootVersion = rootPackage.version;
const projectDescription =
  typeof rootPackage.description === "string"
    ? rootPackage.description.trim()
    : "";

const normalizeGithubUrl = (value) => {
  if (typeof value !== "string" || value.trim() === "") return null;

  return value
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
};

// `repository` outranks `homepage`: homepage is the docs site, not GitHub.
const getRepositoryUrl = (pkg) => {
  const repository = pkg.repository;
  const fromRepository =
    typeof repository === "string"
      ? normalizeGithubUrl(repository)
      : normalizeGithubUrl(repository?.url);
  if (fromRepository) return fromRepository;

  return normalizeGithubUrl(pkg.homepage);
};

const getRepositoryInfo = (repositoryUrl) => {
  if (!repositoryUrl) return null;

  try {
    const parsedUrl = new URL(repositoryUrl);
    if (parsedUrl.hostname !== "github.com") return null;

    const [owner, repo] = parsedUrl.pathname
      .split("/")
      .filter(Boolean)
      .slice(0, 2);

    if (!owner || !repo) return null;

    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
    };
  } catch {
    return null;
  }
};

const repositoryInfo = getRepositoryInfo(getRepositoryUrl(rootPackage));
const packageName =
  typeof rootPackage.name === "string" ? rootPackage.name.trim() : "";
const defaultProjectName = packageName.split("/").pop() || "project";
const projectName =
  defaultProjectName.charAt(0).toUpperCase() + defaultProjectName.slice(1);
const projectLink = repositoryInfo?.url || "https://github.com";
const projectOwnerName = repositoryInfo?.owner || projectName;
const projectOwnerProfileUrl = `https://github.com/${projectOwnerName}`;
const projectOwnerAvatarUrl = `https://github.com/${projectOwnerName}.png?size=64`;

const contributors = Array.isArray(rootPackage.contributors)
  ? rootPackage.contributors
  : [];

const maintainers = contributors
  .map((contributor) => {
    if (!contributor || typeof contributor !== "object") return null;

    const name =
      typeof contributor.name === "string" ? contributor.name.trim() : "";
    const url =
      typeof contributor.url === "string" ? contributor.url.trim() : "";

    if (!name || !url?.includes("github.com/")) return null;

    const githubUsername = url.replace(/\/$/, "").split("/").pop();
    if (!githubUsername) return null;

    return {
      name,
      profileUrl: `https://github.com/${githubUsername}`,
      avatarUrl: `https://github.com/${githubUsername}.png?size=64`,
    };
  })
  .filter(Boolean);

const formatMaintainersAsTs = (items) => {
  const lines = items.flatMap((maintainer) => [
    "  {",
    `    name: ${JSON.stringify(maintainer.name)},`,
    `    profileUrl: ${JSON.stringify(maintainer.profileUrl)},`,
    `    avatarUrl: ${JSON.stringify(maintainer.avatarUrl)},`,
    "  },",
  ]);

  if (lines.length === 0) {
    return "[]";
  }

  return `[\n${lines.join("\n")}\n]`;
};

if (!rootVersion) {
  throw new Error("Root package.json is missing a version field.");
}

const siteMetaFileContent = `// Generated file. Do not edit directly.\n\nexport const cliVersion = "${rootVersion}";\nexport const projectName = ${JSON.stringify(projectName)};\nexport const projectDescription = ${JSON.stringify(projectDescription)};\nexport const projectLink = ${JSON.stringify(projectLink)};\nexport const projectOwnerName = ${JSON.stringify(projectOwnerName)};\nexport const projectOwnerProfileUrl = ${JSON.stringify(projectOwnerProfileUrl)};\nexport const projectOwnerAvatarUrl = ${JSON.stringify(projectOwnerAvatarUrl)};\n\nexport const maintainers = ${formatMaintainersAsTs(maintainers)} as const;\n`;
await writeFile(docsSiteMetaFilePath, siteMetaFileContent);

console.log(`[docs] Synced site metadata to CLI version ${rootVersion}`);
