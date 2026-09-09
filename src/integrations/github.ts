import { input } from "@inquirer/prompts";
import { commandExists, run } from "../lib/cli.js";
import { gitGetConfigValue, gitSetConfigValue } from "../lib/git.js";

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

async function getGitHubTokenFromGhCli(): Promise<string> {
  if (!(await commandExists("gh"))) {
    return "";
  }
  try {
    return await run("gh", ["auth", "token"]);
  } catch {
    return "";
  }
}

async function resolveGitHubToken(): Promise<string> {
  const ghToken = await getGitHubTokenFromGhCli();
  if (ghToken) {
    await gitSetConfigValue("github.token", ghToken);
    return ghToken;
  }

  console.log(
    "Go to https://github.com/settings/personal-access-tokens/new to create a new token and then paste it here.",
  );
  const token = await input({ message: "Enter GitHub token:" });
  if (!token) {
    throw new Error("GitHub token not provided.");
  }
  await gitSetConfigValue("github.token", token);
  return token;
}

interface GitHubRequestOptions {
  method?: string;
  body?: unknown;
}

function fetchGitHub(
  path: string,
  token?: string,
  { method, body }: GitHubRequestOptions = {},
): Promise<Response> {
  const headers = getGitHubHeaders(token);
  const init: RequestInit = { headers };

  if (method) {
    init.method = method;
  }

  // Only a request that carries a body announces a content type, so a GET is
  // sent exactly as it was before this argument existed.
  if (body !== undefined) {
    init.headers = { ...headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  return fetch(`https://api.github.com${path}`, init);
}

// fetchGitHubIssue resolves a token lazily, because a public repository answers
// its unauthenticated probe and never needs one. A write always needs one, so
// this is the eager counterpart: the configured token, or a freshly resolved
// one, which may prompt for a PAT.
async function requireGitHubToken(): Promise<string> {
  const configuredToken = await gitGetConfigValue("github.token");
  if (configuredToken) {
    return configuredToken;
  }

  return resolveGitHubToken();
}

export async function fetchGitHubIssue(issueId: number | string) {
  const normalizedIssueId = String(issueId).trim();

  if (!/^\d+$/.test(normalizedIssueId)) {
    throw new Error(`GitHub: Invalid issue id "${issueId}".`);
  }

  const { owner, name } = await getCurrentGitHubRepository();
  let token = await gitGetConfigValue("github.token");

  if (!token) {
    const infoResponse = await fetchGitHub(`/repos/${owner}/${name}`);
    if (!infoResponse.ok) {
      token = await resolveGitHubToken();
    }
  }

  const response = await fetchGitHub(
    `/repos/${owner}/${name}/issues/${normalizedIssueId}`,
    token,
  );

  if (!response.ok) {
    const errorMessage = await response.text();
    throw new Error(
      `GitHub: Failed to fetch issue ${normalizedIssueId} from ${owner}/${name}. ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`,
    );
  }

  const issue = (await response.json()) as GitHubIssueApiResponse;

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
    user: {
      login: issue.user.login,
      htmlUrl: issue.user.html_url,
    },
  } satisfies GitHubIssue;
}

export async function fetchGitHubLogin(token?: string): Promise<string> {
  const resolvedToken = token ?? (await requireGitHubToken());
  const response = await fetchGitHub("/user", resolvedToken);

  if (!response.ok) {
    const errorMessage = await response.text();
    throw new Error(
      `GitHub: Failed to resolve the authenticated user. ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`,
    );
  }

  const user = (await response.json()) as { login: string };

  return user.login;
}

export async function assignGitHubIssue(issueId: number | string) {
  const normalizedIssueId = String(issueId).trim();

  if (!/^\d+$/.test(normalizedIssueId)) {
    throw new Error(`GitHub: Invalid issue id "${issueId}".`);
  }

  const { owner, name } = await getCurrentGitHubRepository();
  // Resolved once and passed on, so a run that has to prompt for a PAT prompts
  // exactly once even if the write to git config does not stick.
  const token = await requireGitHubToken();
  const login = await fetchGitHubLogin(token);

  const response = await fetchGitHub(
    `/repos/${owner}/${name}/issues/${normalizedIssueId}/assignees`,
    token,
    { method: "POST", body: { assignees: [login] } },
  );

  if (!response.ok) {
    const errorMessage = await response.text();
    throw new Error(
      `GitHub: Failed to assign issue ${normalizedIssueId} in ${owner}/${name}. ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`,
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
