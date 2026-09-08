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

function getGitHubHeaders(token?: string): HeadersInit {
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

function fetchGitHub(path: string, token?: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: getGitHubHeaders(token),
  });
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

export { parseGitHubRepositoryFromRemote };
