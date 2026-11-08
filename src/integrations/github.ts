import {
  type BranchMatch,
  type BranchNaming,
  evaluateBranchTypeRules,
  type IssueField,
  matchOfResult,
} from "../lib/branch-type.js";
import { commandExists, run } from "../lib/cli.js";
import { gitGetConfigValue, gitSetConfigValue } from "../lib/config.js";
import {
  type BranchKind,
  getBranchPrefix,
  getBranchTypeRules,
  getTeamConfigValue,
  renderBranchName,
} from "../lib/project-config.js";
import {
  askInput,
  assertCanPrompt,
  InvalidValueError,
  MissingValueError,
} from "../lib/prompt.js";
import { quotablePastedUrl, redactSecrets } from "../lib/redact.js";
import { slugifyBranchTitle } from "../lib/utils.js";
import {
  isValidGitHubHost,
  isValidGitHubRepository,
} from "../lib/validators.js";

interface GitHubRepository {
  owner: string;
  name: string;
}

/** Where the repository a run reads came from (D1). */
export type GitHubRepositorySource =
  | "github.repository"
  | "upstream"
  | "origin";

export interface ResolvedGitHubRepository extends GitHubRepository {
  source: GitHubRepositorySource;
  /**
   * The GitHub Enterprise host the repository lives on (#120 D1, D2). Absent
   * for github.com, so a github.com result is the shape it always was.
   */
  host?: string;
}

export interface GitHubIssueTypeApiResponse {
  id: number;
  node_id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  updated_at: string;
  is_enabled: boolean;
}

export interface GitHubIssueType {
  id: number;
  nodeId: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  isEnabled: boolean;
}

export interface GitHubIssue {
  url: string;
  repositoryUrl: string;
  labelsUrl: string;
  commentsUrl: string;
  eventsUrl: string;
  id: number;
  nodeId: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  stateReason: string | null;
  comments: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  authorAssociation: string;
  htmlUrl: string;
  type: GitHubIssueType | null;
  /** Each label's id and name; a label given as a bare string has no id. */
  labels: { id?: number; name: string }[];
  /**
   * Set when the number is a pull request, which GitHub's issues endpoint
   * answers for too. `headBranch` is the branch the pull request is from, or
   * null when it could not be read.
   */
  pullRequest: { headBranch: string | null } | null;
  /**
   * The repository the issue was read from. Always set by `fetchGitHubIssue`;
   * optional so an issue built by hand, as the naming tests do, stays valid.
   */
  repository?: ResolvedGitHubRepository;
  user: {
    login: string;
    htmlUrl: string;
  };
}

export interface GitHubRepositoryInfo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
}

export interface GitHubIssueApiResponse {
  url: string;
  repository_url: string;
  labels_url: string;
  comments_url: string;
  events_url: string;
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason: string | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  author_association: string;
  type: GitHubIssueTypeApiResponse | null;
  // Objects in the REST API; older payloads and some proxies send bare names.
  labels: (string | { id?: number; name?: string; [field: string]: unknown })[];
  // Present only when the number is a pull request.
  pull_request?: { url: string };
  html_url: string;
  user: {
    login: string;
    html_url: string;
  };
  assignees: {
    login: string;
    html_url: string;
  }[];
}

export interface GitHubRemote {
  host: string;
  owner: string;
  name: string;
}

const GITHUB_COM = "github.com";

// `[scheme://][user[:password]@]host[:port]/path`, for the schemes git clones
// over (https://git-scm.com/docs/git-clone#_git_urls), plus `git+ssh` and
// `ssh+git`, which git still takes as `ssh` (connect.c `get_protocol`). IPv6
// literals are not GitHub hosts and are not read.
const URL_REMOTE =
  /^(?:ssh|git|git\+ssh|ssh\+git|https?):\/\/(?:[^@/]*@)?([^/:@\s]+)(?::\d*)?\/(.+)$/i;
// Names for github.com itself: SSH over the HTTPS port, and the `www.` host,
// which answers git with a redirect to github.com.
const GITHUB_COM_ALIASES = new Set(["ssh.github.com", "www.github.com"]);
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// scp-like `[user@]host:[/]path`, which git takes only when no `/` comes
// before the first `:`; `[^/:@]+` for the host keeps it so.
const SCP_REMOTE = /^(?:[^@/:]+@)?([^/:@\s]+):\/?(.+)$/;

/**
 * Host, owner and name of any git remote URL (D6), or undefined when the value
 * is not a remote of that shape or its owner and name are not ones GitHub
 * allows (`isValidGitHubRepository`). The host is lower-cased, any port is
 * dropped, and `ssh.github.com` (SSH over the HTTPS port) and `www.github.com`
 * are `github.com`.
 * Whether the host is one to talk to is the caller's decision.
 */
export function parseGitHubRemote(remoteUrl: string): GitHubRemote | undefined {
  const value = remoteUrl.trim();
  const match =
    URL_REMOTE.exec(value) ??
    (ANY_SCHEME.test(value) ? null : SCP_REMOTE.exec(value));
  if (!match) {
    return undefined;
  }

  const [, rawHost, path] = match;
  const parts = path
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .split("/");
  if (parts.length !== 2) {
    return undefined;
  }
  const [owner, name] = parts;
  if (isValidGitHubRepository(`${owner}/${name}`) !== true) {
    return undefined;
  }

  const host = rawHost.toLowerCase();
  return {
    host: GITHUB_COM_ALIASES.has(host) ? GITHUB_COM : host,
    owner,
    name,
  };
}

/**
 * The REST API's base URL for a host, and a function of the host alone (D5):
 * `https://api.github.com`, `https://api.<host>` under `.ghe.com` (Enterprise
 * Cloud with data residency), else `https://<host>/api/v3` (Enterprise
 * Server). Always https, whatever scheme a remote used.
 */
export function githubApiBaseUrl(host: string): string {
  const normalizedHost = host.toLowerCase();
  if (normalizedHost === GITHUB_COM) {
    return "https://api.github.com";
  }
  if (normalizedHost.endsWith(".ghe.com")) {
    return `https://api.${normalizedHost}`;
  }
  return `https://${normalizedHost}/api/v3`;
}

const ENTERPRISE_HOST_HINT =
  "If this repository is on GitHub Enterprise, set its host with `worktree config github.host <host>`.";

// A remote counts only when it is on the host this run talks to (#120 D2), so
// an `upstream` or `origin` elsewhere is never read, however it parses.
function repositoryOnHost(
  remoteUrl: string,
  host: string,
): GitHubRepository | undefined {
  const remote = parseGitHubRemote(remoteUrl);
  return remote?.host === host
    ? { owner: remote.owner, name: remote.name }
    : undefined;
}

function unableToDetermineMessage(remoteUrl: string): string {
  return `GitHub: Unable to determine the current repository from origin remote "${redactSecrets(remoteUrl)}". ${ENTERPRISE_HOST_HINT}`;
}

function parseGitHubRepositoryFromRemote(remoteUrl: string): GitHubRepository {
  const repository = repositoryOnHost(remoteUrl, GITHUB_COM);
  if (!repository) {
    throw new Error(unableToDetermineMessage(remoteUrl));
  }
  return repository;
}

async function readOriginRemoteUrl(): Promise<string> {
  try {
    return await run("git", ["remote", "get-url", "origin"]);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `GitHub: Unable to read the origin remote for the current repository. ${error.message}`,
      );
    }

    throw new Error(
      "GitHub: Unable to read the origin remote for the current repository.",
    );
  }
}

async function readOriginRepository(host: string): Promise<GitHubRepository> {
  const remoteUrl = await readOriginRemoteUrl();
  const repository = repositoryOnHost(remoteUrl, host);
  if (repository) {
    return repository;
  }
  if (host === GITHUB_COM) {
    throw new Error(
      `GitHub: Unable to read the origin remote for the current repository. ${unableToDetermineMessage(remoteUrl)}`,
    );
  }
  throw new Error(
    `GitHub: github.host is ${host}, but the origin remote "${redactSecrets(remoteUrl)}" is not on that host. An Enterprise host has to be named by github.host and by a remote of this clone; correct github.host, or unset it to use github.com.`,
  );
}

// D3: an `upstream` that is missing, or is not on this run's host, is not
// evidence about this host's issues, so either answer is "none" and resolution
// carries on to origin. Neither case is an error.
async function readUpstreamRepository(
  host: string,
): Promise<GitHubRepository | undefined> {
  let remoteUrl: string;
  try {
    remoteUrl = await run("git", ["remote", "get-url", "upstream"]);
  } catch {
    return undefined;
  }
  return repositoryOnHost(remoteUrl, host);
}

/**
 * The host `--github` and `--assign` talk to (#120 D1, D7): `github.host`, else
 * github.com. Checked again here because git config can be edited by hand and
 * the value goes into a URL and into gh's argv.
 */
export async function resolveGitHubHost(): Promise<string> {
  const configured = await getTeamConfigValue("github.host");
  if (!configured) {
    return GITHUB_COM;
  }
  const verdict = isValidGitHubHost(configured);
  if (verdict !== true) {
    throw new InvalidValueError(
      `GitHub: github.host "${redactSecrets(configured)}" is not valid. ${verdict}`,
    );
  }
  return configured.toLowerCase();
}

/**
 * The repository `--github` reads and `--assign` assigns in (D1, D6): the
 * `github.repository` key, then an `upstream` remote on the configured host,
 * then `origin`. Read and assignment both come through here, so they cannot
 * disagree. The key is checked again here because git config can be edited by
 * hand, and the value goes into a request path.
 *
 * Off github.com the host has to be the resolved remote's too (#120 D2); with
 * `github.repository` it is `origin` that must be on the host, and a remote on
 * any other host fails before a request is made.
 */
export async function resolveGitHubRepository(): Promise<ResolvedGitHubRepository> {
  const host = await resolveGitHubHost();
  const hostField = host === GITHUB_COM ? {} : { host };

  const configured = await getTeamConfigValue("github.repository");
  if (configured) {
    const verdict = isValidGitHubRepository(configured);
    if (verdict !== true) {
      throw new InvalidValueError(
        `GitHub: github.repository "${configured}" is not valid. ${verdict}`,
      );
    }
    if (host !== GITHUB_COM) {
      await readOriginRepository(host);
    }
    const [owner, name] = configured.split("/");
    return { owner, name, source: "github.repository", ...hostField };
  }

  const upstream = await readUpstreamRepository(host);
  if (upstream) {
    return { ...upstream, source: "upstream", ...hostField };
  }

  return {
    ...(await readOriginRepository(host)),
    source: "origin",
    ...hostField,
  };
}

export function hostOf(repository: ResolvedGitHubRepository): string {
  return repository.host ?? GITHUB_COM;
}

/**
 * `owner/repo`, and where it came from when that is not `origin` (D4), so the
 * text for a person whose `origin` is the repository stays what it always was.
 * Off github.com the host leads, `<host>/<owner>/<repo>` (#120 D8).
 */
export function describeGitHubRepository(repository: ResolvedGitHubRepository) {
  const fullName = `${repository.owner}/${repository.name}`;
  const named =
    repository.host && repository.host !== GITHUB_COM
      ? `${repository.host}/${fullName}`
      : fullName;
  return repository.source === "origin"
    ? named
    : `${named} (${repository.source})`;
}

function getGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "@northguild/worktree",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

// D5. A timed-out `gh auth token` rejects, and the catch below already treats
// any failure as "no token from gh".
const GH_AUTH_TOKEN_TIMEOUT_MS = 10_000;
const GITHUB_REQUEST_TIMEOUT_MS = 15_000;

// D4. Always name the host: without `--hostname` gh picks its default host
// (`GH_HOST`, else the single configured one), which need not be this one.
async function getGitHubTokenFromGhCli(host: string): Promise<string> {
  if (!(await commandExists("gh"))) {
    return "";
  }
  try {
    return await run("gh", ["auth", "token", "--hostname", host], {
      timeout: GH_AUTH_TOKEN_TIMEOUT_MS,
    });
  } catch {
    return "";
  }
}

// Where a token came from, which decides what a 401 tells you to do. A token
// in git config wins over `gh`, so `gh auth login` cannot fix it; that
// includes one typed at the prompt, which is saved there. `gh` is a token read
// from `gh auth token` this run and never saved.
type GitHubTokenSource = "stored" | "gh";

interface ResolvedGitHubToken {
  token: string;
  source: GitHubTokenSource;
}

async function resolveGitHubToken(host: string): Promise<ResolvedGitHubToken> {
  const ghToken = await getGitHubTokenFromGhCli(host);
  // Never stored: `gh` owns this token and refreshes it, and a copy in git
  // config would outlive it, win over `gh` from then on, and sit in clear.
  if (ghToken) {
    return { token: ghToken, source: "gh" };
  }

  // #120 D3: a token is bound to its host. The stored `github.token` and a
  // typed one are github.com's, so off github.com there is nothing to prompt
  // for, and an interactive run ends as a non-interactive one does.
  if (host !== GITHUB_COM) {
    throw new MissingValueError(
      `a GitHub token for ${host}`,
      `\`gh auth login --hostname ${host}\``,
    );
  }

  // A token has no default, and the instructions below are for a human. The
  // message names where to put one and never echoes a value.
  const site = {
    value: "a GitHub token",
    flag: "`worktree config github.token <token>` or run `gh auth login`",
  };
  assertCanPrompt(site);
  console.log(
    "Go to https://github.com/settings/personal-access-tokens/new to create a new token and then paste it here.",
  );
  const token = await askInput({ message: "Enter GitHub token:" }, site);
  if (!token) {
    throw new Error("GitHub token not provided.");
  }
  await gitSetConfigValue("github.token", token);
  return { token, source: "stored" };
}

// A 401 on a request that carried a token means GitHub refused that token, so
// the message says so and names what replaces it. Any other status, and a 401
// with no token sent, keeps the plain message. Neither ever includes the token.
async function githubFailure(
  prefix: string,
  response: Response,
  path: string,
  tokenSource?: GitHubTokenSource,
  host: string = GITHUB_COM,
): Promise<Error> {
  const errorMessage = await readGitHubBody(path, () => response.text());
  const message = `${prefix} ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`;
  if (response.status === 401 && tokenSource === "stored") {
    return new Error(
      `${message}\nThe stored github.token was refused. Replace it with \`worktree config github.token <token>\`, or remove it with \`git config --unset northguild.worktree.github.token\` so \`gh auth token\` is used.`,
    );
  }
  if (response.status === 401 && tokenSource === "gh" && host !== GITHUB_COM) {
    return new Error(
      `${message}\nGitHub refused the token. Run \`gh auth login --hostname ${host}\`.`,
    );
  }
  if (response.status === 401 && tokenSource === "gh") {
    return new Error(
      `${message}\nGitHub refused the token. Run \`gh auth login\`, or set a valid one with \`worktree config github.token <token>\`.`,
    );
  }
  return new Error(message);
}

interface GitHubRequestOptions {
  method?: string;
  body?: unknown;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

// The path names the call; the headers, which carry the token, never reach the
// message.
function timeoutError(path: string, cause: unknown): Error {
  return new Error(
    `GitHub: ${path} did not answer within ${GITHUB_REQUEST_TIMEOUT_MS / 1000}s.`,
    { cause },
  );
}

// The request's signal also bounds reading the body, so a body that stalls
// after the headers arrive rejects with the same TimeoutError as the fetch.
async function readGitHubBody<T>(
  path: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutError(path, error);
    }
    throw error;
  }
}

// A rejection that is not a timeout is the network: DNS, TLS, a refused
// connection. fetch's own message is a bare "fetch failed" and the reason is
// its cause, so the host and the cause are what the person needs (#120 D9). The
// headers, which carry the token, never reach the message.
function unreachableError(host: string, error: unknown): Error {
  const reason =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  const detail = reason instanceof Error ? reason.message : String(reason);
  return new Error(
    `GitHub: could not reach ${host}. ${redactSecrets(detail)}`,
    {
      cause: error,
    },
  );
}

async function fetchGitHub(
  host: string,
  path: string,
  token?: string,
  { method, body }: GitHubRequestOptions = {},
): Promise<Response> {
  const headers = getGitHubHeaders(token);
  const init: RequestInit = {
    headers,
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  };

  if (method) {
    init.method = method;
  }

  // Only a request that carries a body announces a content type, so a GET is
  // sent exactly as it was before this argument existed.
  if (body !== undefined) {
    init.headers = { ...headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  try {
    // Redirects keep fetch's default `follow` (#120 D10): the Fetch standard
    // drops Authorization on a cross-origin hop, and a renamed repository's
    // old path redirects within the host.
    return await fetch(`${githubApiBaseUrl(host)}${path}`, init);
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutError(path, error);
    }
    throw unreachableError(host, error);
  }
}

// fetchGitHubIssue resolves a token lazily, because a public repository answers
// its unauthenticated probe and never needs one. A write always needs one, so
// this is the eager counterpart: the configured token, or a freshly resolved
// one, which may prompt for a PAT.
async function requireGitHubToken(host: string): Promise<ResolvedGitHubToken> {
  // The stored token is github.com's; it is not even read for another host.
  if (host === GITHUB_COM) {
    // Git-only: a secret is never read from a file (#281 D9).
    const configuredToken = await gitGetConfigValue("github.token");
    if (configuredToken) {
      return { token: configuredToken, source: "stored" };
    }
  }

  return resolveGitHubToken(host);
}

export interface GitHubIssueReference {
  number: string;
  /** Present only when the input was a URL, which names a repository. */
  repository?: { owner: string; name: string };
}

/**
 * Reads an issue number from what `--github` was given. A pull request URL
 * parses too, so it reaches the existing pull request refusal. Anything not
 * starting with `http://` or `https://` is handed back untouched for the
 * existing validators (D1); any other URL is refused (D6, D8).
 *
 * A URL has to be on `host`, the one `github.host` names (#120 D11), compared
 * case-insensitively (D6); `www.github.com` also passes for github.com. The
 * URL's host is only matched, never requested.
 */
export function parseGitHubIssueReference(
  input: string,
  host: string = GITHUB_COM,
): GitHubIssueReference {
  // A paste can carry surrounding whitespace; a typed id is trimmed later by
  // its own validator, so only the URL test and match see the trimmed value.
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    return { number: input };
  }

  const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hostPattern =
    host.toLowerCase() === GITHUB_COM ? "(?:www\\.)?github\\.com" : escapedHost;
  const match = new RegExp(
    `^https?://${hostPattern}/([^/]+)/([^/]+)/(?:issues|pull)/(\\d+)/?$`,
    "i",
  ).exec(value.replace(/[?#].*$/s, ""));
  if (!match) {
    throw new InvalidValueError(
      `GitHub: expected an issue number or a URL like https://${host}/<owner>/<repo>/issues/<number>, got "${quotablePastedUrl(value)}".`,
    );
  }

  const [, owner, name, number] = match;
  return { number, repository: { owner, name } };
}

export async function fetchGitHubIssue(issueId: number | string) {
  const normalizedIssueId = String(issueId).trim();

  if (!/^\d+$/.test(normalizedIssueId)) {
    throw new InvalidValueError(`GitHub: Invalid issue id "${issueId}".`);
  }

  const repository = await resolveGitHubRepository();
  const { owner, name } = repository;
  const host = hostOf(repository);
  // The stored token is github.com's and is not read for another host (#120 D3);
  // git-only, as a secret is never read from a file (#281 D9).
  let token =
    host === GITHUB_COM ? await gitGetConfigValue("github.token") : "";
  let tokenSource: GitHubTokenSource | undefined = token ? "stored" : undefined;

  if (!token) {
    const infoResponse = await fetchGitHub(host, `/repos/${owner}/${name}`);
    if (!infoResponse.ok) {
      ({ token, source: tokenSource } = await resolveGitHubToken(host));
    }
  }

  const issuePath = `/repos/${owner}/${name}/issues/${normalizedIssueId}`;
  const response = await fetchGitHub(host, issuePath, token);

  if (!response.ok) {
    throw await githubFailure(
      `GitHub: Failed to fetch issue ${normalizedIssueId} from ${describeGitHubRepository(repository)}.`,
      response,
      issuePath,
      tokenSource,
      host,
    );
  }

  const issue = await readGitHubBody<GitHubIssueApiResponse>(issuePath, () =>
    response.json(),
  );
  const pullRequest = issue.pull_request
    ? {
        headBranch: await fetchGitHubPullRequestHeadBranch(
          repository,
          issue.number,
          token,
        ),
      }
    : null;

  return {
    url: issue.url,
    repositoryUrl: issue.repository_url,
    labelsUrl: issue.labels_url,
    commentsUrl: issue.comments_url,
    eventsUrl: issue.events_url,
    id: issue.id,
    nodeId: issue.node_id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    stateReason: issue.state_reason,
    comments: issue.comments,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    authorAssociation: issue.author_association,
    htmlUrl: issue.html_url,
    type: issue.type
      ? {
          id: issue.type.id,
          nodeId: issue.type.node_id,
          name: issue.type.name,
          description: issue.type.description,
          color: issue.type.color,
          createdAt: issue.type.created_at,
          updatedAt: issue.type.updated_at,
          isEnabled: issue.type.is_enabled,
        }
      : null,
    labels: (issue.labels ?? []).flatMap((label) => {
      if (typeof label === "string") {
        return [{ name: label }];
      }
      return typeof label.name === "string"
        ? [
            {
              ...(label.id === undefined ? {} : { id: label.id }),
              name: label.name,
            },
          ]
        : [];
    }),
    pullRequest,
    repository,
    user: {
      login: issue.user.login,
      htmlUrl: issue.user.html_url,
    },
  } satisfies GitHubIssue;
}

// The head branch only improves the message that refuses a pull request, so a
// failed lookup is a null and never a second reason to fail. `worktree
// checkout` resolves against origin (D5), so a branch is suggested only when it
// lives in the repository behind origin: the one the pull request was read from
// when that is origin, else origin's, read here and only for a pull request.
// A fork's branch is not on origin, and its name is anyone's to choose, so it is
// never suggested.
async function fetchGitHubPullRequestHeadBranch(
  repository: ResolvedGitHubRepository,
  number: number,
  token?: string,
): Promise<string | null> {
  try {
    const pullPath = `/repos/${repository.owner}/${repository.name}/pulls/${number}`;
    const response = await fetchGitHub(hostOf(repository), pullPath, token);
    if (!response.ok) {
      return null;
    }
    const pull = await readGitHubBody<{
      head?: { ref?: string; repo?: { full_name?: string } | null };
    }>(pullPath, () => response.json());
    const origin =
      repository.source === "origin"
        ? repository
        : await readOriginRepository(hostOf(repository));
    const headRepository = pull.head?.repo?.full_name?.toLowerCase();
    if (headRepository !== `${origin.owner}/${origin.name}`.toLowerCase()) {
      return null;
    }
    return pull.head?.ref ?? null;
  } catch {
    return null;
  }
}

// A caller that already holds a token passes its source with it, so a 401
// names the remedy for where that token actually came from.
export async function fetchGitHubLogin(
  resolved?: ResolvedGitHubToken,
  host: string = GITHUB_COM,
): Promise<string> {
  const { token, source } = resolved ?? (await requireGitHubToken(host));
  const response = await fetchGitHub(host, "/user", token);

  if (!response.ok) {
    throw await githubFailure(
      "GitHub: Failed to resolve the authenticated user.",
      response,
      "/user",
      source,
      host,
    );
  }

  const user = await readGitHubBody<{ login: string }>("/user", () =>
    response.json(),
  );

  return user.login;
}

// The same sentence the branch, configuration and GitHub guide docs carry.
const ASSIGN_PERMISSION_HINT =
  "Assigning needs a token whose account has push access to the repository; a fine-grained token also needs the Issues (or Pull requests) permission set to Read and write.";

// `repository` is optional for the same reason as on `GitHubIssue`.
export async function assignGitHubIssue(issueId: number | string): Promise<{
  login: string;
  assigned: boolean;
  repository?: ResolvedGitHubRepository;
}> {
  const normalizedIssueId = String(issueId).trim();

  if (!/^\d+$/.test(normalizedIssueId)) {
    throw new InvalidValueError(`GitHub: Invalid issue id "${issueId}".`);
  }

  const repository = await resolveGitHubRepository();
  const { owner, name } = repository;
  // Resolved once and passed on, so a run that reads the token from `gh` or has
  // to prompt for a PAT does so exactly once.
  const host = hostOf(repository);
  const { token, source } = await requireGitHubToken(host);
  const login = await fetchGitHubLogin({ token, source }, host);

  const assigneesPath = `/repos/${owner}/${name}/issues/${normalizedIssueId}/assignees`;
  const response = await fetchGitHub(host, assigneesPath, token, {
    method: "POST",
    body: { assignees: [login] },
  });

  if (!response.ok) {
    const failure = await githubFailure(
      `GitHub: Failed to assign issue ${normalizedIssueId} in ${describeGitHubRepository(repository)}.`,
      response,
      assigneesPath,
      source,
      host,
    );
    // A fine-grained token without Issues write is refused here with a 403
    // (recorded for #61), so the refusal names what the token needs.
    throw response.status === 403
      ? new Error(`${failure.message}\n${ASSIGN_PERMISSION_HINT}`)
      : failure;
  }

  // Confirmed against the response rather than assumed: GitHub documents that an
  // assignee change made without push access is silently ignored, which is a 201
  // whose assignees never gained the login.
  const issue = await readGitHubBody<GitHubIssueApiResponse>(
    assigneesPath,
    () => response.json(),
  );
  const assignees = issue.assignees ?? [];

  return {
    login,
    assigned: assignees.some((assignee) => assignee.login === login),
    repository,
  };
}

export { parseGitHubRepositoryFromRemote };

// D9: GitHub's rule fields in v1 are `Type` and `Labels`. Each is always
// present, so a rule on one never warns; an issue with no type or no labels has
// an empty field, which matches nothing.
export function getGitHubIssueFields(issue: GitHubIssue): IssueField[] {
  return [
    {
      id: "Type",
      name: "Type",
      values: issue.type
        ? [{ id: String(issue.type.id), name: issue.type.name }]
        : [],
    },
    {
      id: "Labels",
      name: "Labels",
      values: (issue.labels ?? []).map((label) => ({
        ...(label.id === undefined ? {} : { id: String(label.id) }),
        name: label.name,
      })),
    },
  ];
}

// Today's mapping, used only when the project file has neither `github.branchType` nor `branchType`.
// An issue of any other type, or none, gets no prefix (D10, #118).
function getBuiltInGitHubBranchKind(
  typeName: string | undefined,
): BranchKind | undefined {
  if (typeName === "Feature") {
    return "feature";
  }
  if (typeName === "Bug") {
    return "bugfix";
  }
  if (typeName === "Task") {
    return "chore";
  }
  return undefined;
}

/**
 * With `github.branchType` (else the shared `branchType`) in the project file
 * the rules decide the kind (D10) and an issue no rule matches gets no prefix
 * unless a rule says `otherwise`; without either the built-in mapping applies. Rule warnings go to `onWarning`.
 */
export async function getGitHubBranchNaming(
  issue: GitHubIssue,
  onWarning: (warning: string) => void = () => {},
  dryRun = false,
): Promise<BranchNaming> {
  const list = await getBranchTypeRules("github");
  const fields = getGitHubIssueFields(issue);

  let kind: BranchKind | undefined;
  let match: BranchMatch;
  if (list) {
    const result = evaluateBranchTypeRules(list.rules, fields, list.listName, {
      // A dry run is where rules are written and checked, so a misspelt field
      // in the shared list still warns there (D5 holds for real runs). The
      // portable Type and Labels never do: no spelling mistake is behind them.
      shared: list.shared,
      dryRun,
    });
    for (const warning of result.warnings) {
      onWarning(warning);
    }
    kind = result.kind;
    match = matchOfResult(result);
  } else {
    kind = getBuiltInGitHubBranchKind(issue.type?.name);
    match = { source: "built-in" };
  }

  const branchName = await renderBranchName({
    prefix: await getBranchPrefix(kind),
    id: String(issue.number),
    slug: slugifyBranchTitle(issue.title),
  });
  return { branchName, kind, fields, match };
}

export async function getGitHubBranchNameFromIssue(
  issue: GitHubIssue,
  onWarning: (warning: string) => void = () => {},
): Promise<string> {
  return (await getGitHubBranchNaming(issue, onWarning)).branchName;
}
