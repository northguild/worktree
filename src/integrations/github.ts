import { commandExists, run } from "../lib/cli.js";
import { gitGetConfigValue, gitSetConfigValue } from "../lib/git.js";
import { askInput, assertCanPrompt, InvalidValueError } from "../lib/prompt.js";

interface GitHubRepository {
  owner: string;
  name: string;
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
  /**
   * Set when the number is a pull request, which GitHub's issues endpoint
   * answers for too. `headBranch` is the branch the pull request is from, or
   * null when it could not be read.
   */
  pullRequest: { headBranch: string | null } | null;
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

function parseGitHubRepositoryFromRemote(remoteUrl: string): GitHubRepository {
  const normalizedRemoteUrl = remoteUrl.trim();
  const match = normalizedRemoteUrl.match(
    /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/,
  );

  if (!match) {
    throw new Error(
      `GitHub: Unable to determine the current repository from origin remote "${remoteUrl}".`,
    );
  }

  return {
    owner: match[1],
    name: match[2],
  };
}

async function getCurrentGitHubRepository(): Promise<GitHubRepository> {
  try {
    const remoteUrl = await run("git", ["remote", "get-url", "origin"]);
    return parseGitHubRepositoryFromRemote(remoteUrl);
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

async function getGitHubTokenFromGhCli(): Promise<string> {
  if (!(await commandExists("gh"))) {
    return "";
  }
  try {
    return await run("gh", ["auth", "token"], {
      timeout: GH_AUTH_TOKEN_TIMEOUT_MS,
    });
  } catch {
    return "";
  }
}

async function resolveGitHubToken(): Promise<string> {
  const ghToken = await getGitHubTokenFromGhCli();
  // Never stored: `gh` owns this token and refreshes it, and a copy in git
  // config would outlive it, win over `gh` from then on, and sit in clear.
  if (ghToken) {
    return ghToken;
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
  return token;
}

// Where a token came from: git config, which wins over `gh` and so is not
// fixed by `gh auth login`, or resolved this run from `gh` or the prompt.
type GitHubTokenSource = "stored" | "resolved";

// A 401 on a request that carried a token means GitHub refused that token, so
// the message says so and names what replaces it. Any other status, and a 401
// with no token sent, keeps the plain message. Neither ever includes the token.
async function githubFailure(
  prefix: string,
  response: Response,
  tokenSource?: GitHubTokenSource,
): Promise<Error> {
  const errorMessage = await response.text();
  const message = `${prefix} ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`;
  if (response.status === 401 && tokenSource === "stored") {
    return new Error(
      `${message}\nThe stored github.token was refused. Replace it with \`worktree config github.token <token>\`, or remove it with \`git config --unset northguild.worktree.github.token\` so \`gh auth token\` is used.`,
    );
  }
  if (response.status === 401 && tokenSource) {
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

async function fetchGitHub(
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
    return await fetch(`https://api.github.com${path}`, init);
  } catch (error) {
    // The path names the call; the headers, which carry the token, never
    // reach the message.
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `GitHub: ${path} did not answer within ${GITHUB_REQUEST_TIMEOUT_MS / 1000}s.`,
        { cause: error },
      );
    }
    throw error;
  }
}

// fetchGitHubIssue resolves a token lazily, because a public repository answers
// its unauthenticated probe and never needs one. A write always needs one, so
// this is the eager counterpart: the configured token, or a freshly resolved
// one, which may prompt for a PAT.
async function requireGitHubToken(): Promise<{
  token: string;
  source: GitHubTokenSource;
}> {
  const configuredToken = await gitGetConfigValue("github.token");
  if (configuredToken) {
    return { token: configuredToken, source: "stored" };
  }

  return { token: await resolveGitHubToken(), source: "resolved" };
}

export async function fetchGitHubIssue(issueId: number | string) {
  const normalizedIssueId = String(issueId).trim();

  if (!/^\d+$/.test(normalizedIssueId)) {
    throw new InvalidValueError(`GitHub: Invalid issue id "${issueId}".`);
  }

  const { owner, name } = await getCurrentGitHubRepository();
  let token = await gitGetConfigValue("github.token");
  let tokenSource: GitHubTokenSource | undefined = token ? "stored" : undefined;

  if (!token) {
    const infoResponse = await fetchGitHub(`/repos/${owner}/${name}`);
    if (!infoResponse.ok) {
      token = await resolveGitHubToken();
      tokenSource = "resolved";
    }
  }

  const response = await fetchGitHub(
    `/repos/${owner}/${name}/issues/${normalizedIssueId}`,
    token,
  );

  if (!response.ok) {
    throw await githubFailure(
      `GitHub: Failed to fetch issue ${normalizedIssueId} from ${owner}/${name}.`,
      response,
      tokenSource,
    );
  }

  const issue = (await response.json()) as GitHubIssueApiResponse;
  const pullRequest = issue.pull_request
    ? {
        headBranch: await fetchGitHubPullRequestHeadBranch(
          owner,
          name,
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
    pullRequest,
    user: {
      login: issue.user.login,
      htmlUrl: issue.user.html_url,
    },
  } satisfies GitHubIssue;
}

// The head branch only improves the message that refuses a pull request, so a
// failed lookup is a null and never a second reason to fail. A fork's branch is
// not on origin, and its name is anyone's to choose, so it is never suggested.
async function fetchGitHubPullRequestHeadBranch(
  owner: string,
  name: string,
  number: number,
  token?: string,
): Promise<string | null> {
  try {
    const response = await fetchGitHub(
      `/repos/${owner}/${name}/pulls/${number}`,
      token,
    );
    if (!response.ok) {
      return null;
    }
    const pull = (await response.json()) as {
      head?: { ref?: string; repo?: { full_name?: string } | null };
    };
    const headRepository = pull.head?.repo?.full_name?.toLowerCase();
    if (headRepository !== `${owner}/${name}`.toLowerCase()) {
      return null;
    }
    return pull.head?.ref ?? null;
  } catch {
    return null;
  }
}

export async function fetchGitHubLogin(
  token?: string,
  tokenSource: GitHubTokenSource = "resolved",
): Promise<string> {
  const resolved = token
    ? { token, source: tokenSource }
    : await requireGitHubToken();
  const response = await fetchGitHub("/user", resolved.token);

  if (!response.ok) {
    throw await githubFailure(
      "GitHub: Failed to resolve the authenticated user.",
      response,
      resolved.source,
    );
  }

  const user = (await response.json()) as { login: string };

  return user.login;
}

export async function assignGitHubIssue(issueId: number | string) {
  const normalizedIssueId = String(issueId).trim();

  if (!/^\d+$/.test(normalizedIssueId)) {
    throw new InvalidValueError(`GitHub: Invalid issue id "${issueId}".`);
  }

  const { owner, name } = await getCurrentGitHubRepository();
  // Resolved once and passed on, so a run that reads the token from `gh` or has
  // to prompt for a PAT does so exactly once.
  const { token, source } = await requireGitHubToken();
  const login = await fetchGitHubLogin(token, source);

  const response = await fetchGitHub(
    `/repos/${owner}/${name}/issues/${normalizedIssueId}/assignees`,
    token,
    { method: "POST", body: { assignees: [login] } },
  );

  if (!response.ok) {
    throw await githubFailure(
      `GitHub: Failed to assign issue ${normalizedIssueId} in ${owner}/${name}.`,
      response,
      source,
    );
  }

  // Confirmed against the response rather than assumed: GitHub documents that an
  // assignee change made without push access is silently ignored, which is a 201
  // whose assignees never gained the login.
  const issue = (await response.json()) as GitHubIssueApiResponse;
  const assignees = issue.assignees ?? [];

  return {
    login,
    assigned: assignees.some((assignee) => assignee.login === login),
  };
}

export { parseGitHubRepositoryFromRemote };
