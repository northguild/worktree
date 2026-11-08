import {
  type BranchMatch,
  type BranchNaming,
  evaluateBranchTypeRules,
  type FieldValue,
  type IssueField,
  matchOfResult,
} from "../lib/branch-type.js";
import { getConfigValue, gitGetConfigValue } from "../lib/config.js";
import {
  getBranchTypeRules,
  getTeamConfigValue,
  renderBranchName,
} from "../lib/project-config.js";
import { InvalidValueError } from "../lib/prompt.js";
import { quotablePastedUrl, redactSecrets } from "../lib/redact.js";
import type { JiraDeployment } from "../lib/types.js";
import { slugifyBranchTitle } from "../lib/utils.js";
import { isValidJiraDeployment } from "../lib/validators.js";

// #126 D4: Cloud sends Basic email:token, Data Center a Bearer personal access
// token. The token lives in `jira.apiToken` for both.
type JiraAuth =
  | { kind: "basic"; email: string; apiToken: string }
  | { kind: "bearer"; token: string };

/** The one resolved site of a call (#126 §4): which Jira, where, and how to sign in. */
interface JiraSite {
  deployment: JiraDeployment;
  host: string;
  auth: JiraAuth;
}

interface JiraFieldSchema {
  type?: string;
  system?: string;
  custom?: string;
}

interface JiraIssue {
  id: string;
  key: string;
  /** Field id to display name; present only when asked for with `expand=names`. */
  names?: Record<string, string>;
  /** Field id to schema; present only when asked for with `expand=schema` (Data Center). */
  schema?: Record<string, JiraFieldSchema>;
  fields: {
    summary: string;
    issuetype: {
      id: string;
      name: string;
    };
    [key: string]: unknown;
  };
}

interface JiraErrorResponse {
  errorMessages?: string[];
  errors: Record<string, string>;
}

export function isJiraError(response: unknown): response is JiraErrorResponse {
  return (
    !!response &&
    typeof response === "object" &&
    ("errorMessages" in response || "errors" in response)
  );
}

export function isJiraIssue(response: unknown): response is JiraIssue {
  return (
    !!response &&
    typeof response === "object" &&
    "key" in response &&
    "fields" in response
  );
}

export function normalizeJiraHost(host: string): string {
  return host
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

export interface JiraIssueReference {
  key: string;
  /**
   * Present only when the input was a URL, which names a site: everything
   * between `https://` and `/browse/`, so a context path is part of it (#126 D6).
   */
  base?: string;
}

/**
 * Reads an issue key from what `--jira` was given. Anything not starting with
 * `http://` or `https://` is handed back untouched for the existing validator
 * (D1); any other URL is refused (D6, D8). The base is only reported: the
 * caller compares it with `jira.host` and never requests it. The key may carry
 * `_` here (#126 D5); `getIssueKey` then decides per deployment.
 */
export function parseJiraIssueReference(input: string): JiraIssueReference {
  // A paste can carry surrounding whitespace; a typed id is trimmed later by
  // its own validator, so only the URL test and match see the trimmed value.
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    return { key: input };
  }

  const match =
    /^https?:\/\/([^/@][^@]*)\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/i.exec(
      value.replace(/[?#].*$/s, ""),
    );
  if (!match) {
    throw new InvalidValueError(
      `Jira: expected an issue key or a URL like https://<host>/browse/<KEY-number>, got "${quotablePastedUrl(value)}".`,
    );
  }

  const [, base, key] = match;
  return { key, base };
}

// #126 D5: Cloud keys have no underscore, so one there is a typo and fails
// before a request. A Data Center admin can allow `_` in a project key.
function getIssueKey(issueId: string, deployment: JiraDeployment): string {
  const normalizedIssueId = issueId.trim().toUpperCase();
  const pattern =
    deployment === "datacenter"
      ? /^[A-Z][A-Z0-9_]*-\d+$/
      : /^[A-Z][A-Z0-9]*-\d+$/;

  if (!pattern.test(normalizedIssueId)) {
    throw new InvalidValueError(`Jira: Invalid issue id "${issueId}".`);
  }

  return normalizedIssueId;
}

function getJiraAuthHeaders(auth: JiraAuth): HeadersInit {
  if (auth.kind === "bearer") {
    return {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
    };
  }
  const encoded = Buffer.from(`${auth.email}:${auth.apiToken}`).toString(
    "base64",
  );

  return {
    Authorization: `Basic ${encoded}`,
    Accept: "application/json",
  };
}

// #126 D3: one helper builds every path, so no call site names a version.
function jiraApiPath(deployment: JiraDeployment, rest: string): string {
  return `/rest/api/${deployment === "datacenter" ? 2 : 3}${rest}`;
}

function isAtlassianCloudHost(host: string): boolean {
  const hostname = host.split("/")[0].split(":")[0].toLowerCase();
  return hostname.endsWith(".atlassian.net");
}

// #126 D9: the 401 text names the deployment's own credentials, and says what
// to change when the deployment looks wrong for the host. A Cloud site on
// *.atlassian.net gets today's text, byte for byte.
function jiraAuthFailure(site: Pick<JiraSite, "deployment" | "host">): Error {
  if (site.deployment === "datacenter") {
    const hint = isAtlassianCloudHost(site.host)
      ? " A *.atlassian.net host is Jira Cloud; run `worktree config jira.deployment cloud`."
      : "";
    return new Error(
      `Jira: Authentication failed. Please verify jira.apiToken (a Jira Data Center personal access token) in your config.${hint}`,
    );
  }
  const hint = isAtlassianCloudHost(site.host)
    ? ""
    : " If this is Jira Data Center or Server, run `worktree config jira.deployment datacenter`.";
  return new Error(
    `Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.${hint}`,
  );
}

/**
 * Which Jira the host is (#126 D1, D2): the `jira.deployment` key, git config
 * then the project file, and `cloud` when neither sets it. The deployment is
 * configured rather than detected from the host. The value is checked again
 * here because git config can be edited by hand.
 */
export async function resolveJiraDeployment(): Promise<JiraDeployment> {
  const configured = await getTeamConfigValue("jira.deployment");
  if (!configured) {
    return "cloud";
  }
  const verdict = isValidJiraDeployment(configured);
  if (verdict !== true) {
    throw new InvalidValueError(
      `Jira: jira.deployment "${redactSecrets(configured)}" is not valid. ${verdict}`,
    );
  }
  // The verdict above admits only these two values, so this narrows without a cast.
  return configured === "datacenter" ? "datacenter" : "cloud";
}

interface JiraSettings {
  deployment: JiraDeployment;
  host: string;
  email: string;
  apiToken: string;
}

// The deployment is read first: Data Center never reads `jira.email` (#126 D4).
async function readJiraSettings(): Promise<JiraSettings> {
  const deployment = await resolveJiraDeployment();
  // One after another, so the order of the three reads is the order written.
  // D17: a host from the project file is trusted like merged code, so no prompt.
  const host = await getTeamConfigValue("jira.host");
  const email =
    deployment === "cloud" ? (await getConfigValue("jira.email")).value : "";
  // Git-only: a secret is never read from a file (#281 D9).
  const apiToken = await gitGetConfigValue("jira.apiToken");
  return { deployment, host, email, apiToken };
}

function buildJiraSite(settings: JiraSettings): JiraSite {
  const { deployment, host, email, apiToken } = settings;

  if (!host) {
    throw new Error(
      'Jira: Missing config value "jira.host". Run "worktree config" to configure Jira integration.',
    );
  }

  if (deployment === "cloud" && !email) {
    throw new Error(
      'Jira: Missing config value "jira.email". Run "worktree config" to configure Jira integration.',
    );
  }

  if (!apiToken) {
    throw new Error(
      'Jira: Missing config value "jira.apiToken". Run "worktree config" to configure Jira integration.',
    );
  }

  const normalizedHost = normalizeJiraHost(host);

  if (!normalizedHost) {
    throw new Error(
      'Jira: Config value "jira.host" cannot be empty. Run "worktree config" to update it.',
    );
  }

  return {
    deployment,
    host: normalizedHost,
    auth:
      deployment === "datacenter"
        ? { kind: "bearer", token: apiToken }
        : { kind: "basic", email, apiToken },
  };
}

async function resolveJiraSite(): Promise<JiraSite> {
  return buildJiraSite(await readJiraSettings());
}

// The key is checked against the deployment's pattern before the site is
// complete, so a bad key still makes no request and a missing config value
// does not hide it.
async function resolveJiraTarget(
  issueId: string,
): Promise<{ issueKey: string; site: JiraSite }> {
  const settings = await readJiraSettings();
  const issueKey = getIssueKey(issueId, settings.deployment);
  return { issueKey, site: buildJiraSite(settings) };
}

function getJiraBranchType(issue: JiraIssue) {
  const issueType = issue.fields.issuetype;
  const issueTypeName = issueType.name.toLowerCase();

  if (
    issueTypeName === "task" ||
    issueTypeName === "chore" ||
    issueTypeName === "maintenance"
  ) {
    return "chore" as const;
  }

  if (issueTypeName === "bug") {
    return "bugfix" as const;
  }

  return "feature" as const;
}

// #126 D11: Data Center returns rich text as plain strings, so it is told
// apart by the schema: the system `description` and `environment` (both
// wiki-rendered), and custom fields of the textarea type (docs.atlassian.com
// api/2/field; Atlassian KB "REST API essential parameters for custom field
// creation"). #294: the Development field, which the bundled
// development-integration plugin puts on every Jira Software issue, returns a
// Java `toString` whose object ids change on every request, so it is dropped
// by its custom type too.
const RICH_TEXT_SYSTEMS = new Set(["description", "environment"]);
const TEXTAREA_CUSTOM_TYPE =
  "com.atlassian.jira.plugin.system.customfieldtypes:textarea";
const DEVELOPMENT_CUSTOM_TYPE =
  "com.atlassian.jira.plugins.jira-development-integration-plugin:devsummary";
const VALUELESS_CUSTOM_TYPES = new Set([
  TEXTAREA_CUSTOM_TYPE,
  DEVELOPMENT_CUSTOM_TYPE,
]);

function hasNoRuleValue(schema: JiraFieldSchema | undefined): boolean {
  return (
    schema !== undefined &&
    ((schema.system !== undefined && RICH_TEXT_SYSTEMS.has(schema.system)) ||
      (schema.custom !== undefined &&
        VALUELESS_CUSTOM_TYPES.has(schema.custom)))
  );
}

// D9: what a field holds, in the shape the rules compare. A select option is
// its `value`; an issue type, component, priority or status its `name`; a user
// its `displayName`; a cascading select both levels; a label or a number
// itself. Anything else (rich text, dates, objects of an unknown shape) is
// nothing, so a rule on it matches nothing rather than guessing. A user's id is
// its `accountId` on Cloud and its `key` on Data Center (D11).
function normalizeJiraFieldValue(
  raw: unknown,
  deployment: JiraDeployment,
): FieldValue[] {
  if (typeof raw === "string" || typeof raw === "number") {
    return [{ name: String(raw) }];
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => normalizeJiraFieldValue(item, deployment));
  }
  if (typeof raw !== "object" || raw === null) {
    return [];
  }
  const option = raw as Record<string, unknown>;
  // `displayName` before `name`: a Data Center user's `name` is its username.
  const label = [option.value, option.displayName, option.name].find(
    (candidate) => typeof candidate === "string",
  );
  const identifier =
    option.id ??
    option.accountId ??
    (deployment === "datacenter" ? option.key : undefined);
  const own: FieldValue[] =
    typeof label === "string" || identifier !== undefined
      ? [
          {
            ...(typeof identifier === "string" || typeof identifier === "number"
              ? { id: String(identifier) }
              : {}),
            ...(typeof label === "string" ? { name: label } : {}),
          },
        ]
      : [];
  return [...own, ...normalizeJiraFieldValue(option.child, deployment)];
}

// The portable names (D3, D4): `Type` and `Labels` are added beside `issuetype`
// and `labels`, found by id since the display name only arrives with
// `expand=names` and is localized. Each is skipped when a field of that name or
// id exists, so a real custom field is never shadowed or made ambiguous, and an
// English Jira, whose `labels` is already named Labels, gets no second one.
export function getJiraIssueFields(
  issue: JiraIssue,
  deployment: JiraDeployment = "cloud",
): IssueField[] {
  const fields = Object.entries(issue.fields).map(([id, raw]) => ({
    id,
    name: issue.names?.[id] ?? id,
    values: hasNoRuleValue(issue.schema?.[id])
      ? []
      : normalizeJiraFieldValue(raw, deployment),
  }));
  const aliases = [
    { alias: "Type", native: "issuetype" },
    { alias: "Labels", native: "labels" },
  ].flatMap(({ alias, native }) => {
    const source = fields.find((field) => field.id === native);
    const taken = fields.some(
      (field) =>
        field.id === alias || field.name.toLowerCase() === alias.toLowerCase(),
    );
    return source && !taken
      ? [{ id: alias, name: alias, values: source.values }]
      : [];
  });
  return [...fields, ...aliases];
}

const JIRA_REQUEST_TIMEOUT_MS = 15_000;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

// D5: a timeout names the call. The path goes in the message; the auth
// headers, which carry the token, never do.
function timeoutError(path: string, cause: unknown): Error {
  return new Error(
    `Jira: ${path} did not answer within ${JIRA_REQUEST_TIMEOUT_MS / 1000}s.`,
    { cause },
  );
}

// The request's signal also bounds reading the body, so a body that stalls
// after the headers arrive rejects with the same TimeoutError as the fetch.
async function readJiraBody<T>(
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

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

// #295: an SSO gateway in front of Jira answers an API call with its sign-in
// page, often after a redirect to another origin, and fetch hands that over as
// a 200. Say what arrived and from which host. Hosts only: no header value,
// and so never the token (D10).
function webPageInsteadOfApi(site: JiraSite, response: Response): Error | null {
  const contentType = response.headers?.get?.("content-type") ?? "";

  if (!/\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
    return null;
  }

  // site.host may carry a context path (example.com/jira); compare hosts.
  const siteHost = hostOf(`https://${site.host}`) ?? site.host;
  const finalHost = (response.url && hostOf(response.url)) || siteHost;
  const redirect =
    response.redirected && finalHost !== siteHost
      ? ` after a redirect from ${siteHost}`
      : "";

  return new Error(
    `Jira: ${finalHost} answered with a web page${redirect}, not the API. A sign-in gateway in front of Jira may need a browser session or an exception for API calls.`,
  );
}

// Reads a JSON body, but first says so when the answer is a web page.
async function readJiraJson<T>(
  path: string,
  site: JiraSite,
  response: Response,
): Promise<T> {
  const page = webPageInsteadOfApi(site, response);

  if (page) {
    throw page;
  }

  return readJiraBody<T>(path, () => response.json() as Promise<T>);
}

// Node's TLS verification codes that a private certificate authority causes.
const PRIVATE_CA_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
]);

// #126 D10: an unreachable site is named by host and error code alone. The
// raw error is never passed on: undici can quote the Authorization value in its
// message, and `redactSecrets` knows no Atlassian token shape. The code is
// shown only if it looks like one, so nothing else can ride along.
//
// Only a failure on the wire says "could not reach", and undici gives each of
// those a cause with a code. `fetch` also refuses some requests before any
// connection: a URL it cannot parse (whose code is ERR_INVALID_URL), user info
// in the URL, a header value it cannot send, a blocked port. Those point at the
// config, not at DNS or a VPN, so they get their own message and the error's
// name, never its text.
function unreachableError(site: JiraSite, error: unknown): Error {
  // User info in jira.host (`user:pw@host`) must not reach the message: with no
  // scheme, `redactSecrets` would not mask it.
  const host = site.host.replace(/^[^/@]*@/, "");
  const cause = error instanceof Error ? error.cause : undefined;
  const raw =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  const code =
    typeof raw === "string" && /^[A-Z0-9_]+$/.test(raw) ? raw : undefined;

  if (!code || code === "ERR_INVALID_URL") {
    const name =
      error instanceof Error && /^[A-Za-z]+$/.test(error.name)
        ? error.name
        : "unknown error";
    // Only a Bearer token is sent as typed; a Cloud token is base64 encoded.
    const keys =
      site.deployment === "datacenter"
        ? "jira.host and jira.apiToken"
        : "jira.host";
    return new Error(
      `Jira: the request to ${host} could not be made (${code ?? name}). Check ${keys} in your config.`,
    );
  }

  const hint = PRIVATE_CA_CODES.has(code)
    ? " If the site uses a private certificate authority, set NODE_EXTRA_CA_CERTS to a file with its certificate."
    : "";
  return new Error(`Jira: could not reach ${host} (${code}).${hint}`);
}

// D5: every Jira request is bounded, body included.
async function fetchJira(
  path: string,
  site: JiraSite,

  init: { method?: "GET" | "PUT" | "POST"; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(getJiraAuthHeaders(site.auth) as Record<string, string>),
  };
  const hasBody = init.body !== undefined;

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  try {
    // #126 D7: always https, so a Bearer token never travels in clear.
    return await fetch(`https://${site.host}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(JIRA_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutError(path, error);
    }
    throw unreachableError(site, error);
  }
}

/**
 * `names` asks Jira for field display names, which only the rules need (D9).
 * Data Center adds `schema` to tell rich text and the Development field from
 * plain text (D11, #294).
 */
export async function fetchJiraIssue(
  issueId: string,
  options: { names?: boolean } = {},
): Promise<JiraIssue> {
  return (await readJiraIssue(issueId, options)).issue;
}

// The issue with the deployment it came from, so its fields are read the way
// that deployment writes them without a second look at the config.
async function readJiraIssue(
  issueId: string,
  options: { names?: boolean },
): Promise<{ issue: JiraIssue; deployment: JiraDeployment }> {
  const { issueKey, site } = await resolveJiraTarget(issueId);

  const issuePath = jiraApiPath(
    site.deployment,
    `/issue/${issueKey}${options.names ? `?expand=${site.deployment === "datacenter" ? "names,schema" : "names"}` : ""}`,
  );
  const response = await fetchJira(issuePath, site);
  const loginReason = response.headers?.get?.("x-seraph-loginreason");

  if (response.status === 401 || loginReason === "AUTHENTICATED_FAILED") {
    throw jiraAuthFailure(site);
  }

  if (!response.ok) {
    const errorMessage = await readJiraBody(issuePath, () => response.text());
    throw new Error(
      `Jira: Failed to fetch issue ${issueKey}. ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`,
    );
  }

  const data = await readJiraJson<unknown>(issuePath, site, response);

  if (isJiraError(data)) {
    const errorMessage =
      data.errorMessages?.join(", ") ||
      Object.values(data.errors ?? {}).join(", ") ||
      "Unknown Jira API error";
    throw new Error(`Jira: ${errorMessage}`);
  }

  if (!isJiraIssue(data)) {
    throw new Error(`Jira: Unable to find issue ${issueKey}.`);
  }

  return { issue: data, deployment: site.deployment };
}

/**
 * With `jira.branchType` (else the shared `branchType`) in the project file the
 * rules decide the kind (D10) and an issue no rule matches gets no prefix;
 * without either the built-in mapping applies. Rule warnings go to
 * `onWarning`. A dry run asks Jira for display names even with no rules (D9),
 * because showing them is its job.
 */
export async function getJiraBranchNaming(
  issueId: string,
  options: { onWarning?: (warning: string) => void; dryRun?: boolean } = {},
): Promise<BranchNaming> {
  const list = await getBranchTypeRules("jira");
  const { issue, deployment } = await readJiraIssue(issueId, {
    names: list !== undefined || options.dryRun === true,
  });
  const fields = getJiraIssueFields(issue, deployment);

  let kind: ReturnType<typeof getJiraBranchType> | undefined;
  let match: BranchMatch;
  if (list) {
    const result = evaluateBranchTypeRules(list.rules, fields, list.listName, {
      // A dry run is where rules are written and checked, so a misspelt field
      // in the shared list still warns there (D5 holds for real runs).
      shared: list.shared && options.dryRun !== true,
    });
    for (const warning of result.warnings) {
      options.onWarning?.(warning);
    }
    kind = result.kind;
    match = matchOfResult(result);
  } else {
    kind = getJiraBranchType(issue);
    match = { source: "built-in" };
  }

  const prefixConfigName =
    kind === "bugfix"
      ? "branchPrefix.bugfix"
      : kind === "chore"
        ? "branchPrefix.chore"
        : kind === "feature"
          ? "branchPrefix.feature"
          : undefined;

  const prefix = prefixConfigName
    ? await getTeamConfigValue(prefixConfigName)
    : "";

  const branchName = await renderBranchName({
    prefix,
    id: issue.key,
    slug: slugifyBranchTitle(issue.fields.summary),
  });
  return { branchName, kind, fields, match };
}

export async function getJiraBranchNameFromIssue(
  issueId: string,
  onWarning: (warning: string) => void = () => {},
): Promise<string> {
  return (await getJiraBranchNaming(issueId, { onWarning })).branchName;
}

export async function validateJiraCredentials(): Promise<boolean> {
  try {
    const site = await resolveJiraSite();
    const response = await fetchJira(
      jiraApiPath(site.deployment, "/myself"),
      site,
    );

    // #295: a gateway's 200 sign-in page is not Jira accepting the token.
    return response.ok && webPageInsteadOfApi(site, response) === null;
  } catch {
    return false;
  }
}

/** `displayName` is the caller's own; `heldBy` is whoever has the issue. */
export type JiraAssignment =
  | { outcome: "assigned" | "already-yours"; displayName: string }
  | { outcome: "held-by-other"; displayName: string; heldBy: string };

interface JiraUser {
  accountId?: string;
  key?: string;
  name?: string;
  displayName?: string;
}

// D5: a failed assignment is named in the person's terms. The messages carry
// the issue key and the API's own text, never a header. `step` is which of the
// three requests failed, because each needs something different: reading the
// caller needs only a login, reading the issue needs Browse Projects, and
// writing its assignee needs Assign Issues.
async function jiraAssignFailure(
  response: Response,
  path: string,
  issueKey: string,
  step: "caller" | "issue" | "assignee",
  site: JiraSite,
): Promise<Error> {
  if (response.status === 401) {
    // D9: on Data Center the caller was read with this same token, so a 401 at
    // the write is the missing Assign Issues permission, not a bad token.
    if (site.deployment === "datacenter" && step === "assignee") {
      return new Error(
        `Jira: The account behind jira.apiToken (a Jira Data Center personal access token) lacks the Assign Issues permission on the project of ${issueKey}.`,
      );
    }
    return jiraAuthFailure(site);
  }

  if (response.status === 403 && step !== "caller") {
    const permission = step === "issue" ? "Browse Projects" : "Assign Issues";
    return new Error(
      `Jira: Your account lacks the ${permission} permission on the project of ${issueKey}.`,
    );
  }

  if (response.status === 404 && step !== "caller") {
    return new Error(`Jira: Issue ${issueKey} was not found.`);
  }

  const errorMessage = await readJiraBody(path, () => response.text());
  const detail = `${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`;

  if (response.status === 400 && step === "assignee") {
    return new Error(
      `Jira: The account was not accepted as assignee for ${issueKey}. ${detail}`,
    );
  }

  return new Error(`Jira: Failed to assign issue ${issueKey}. ${detail}`);
}

// D1/D2: assigns the issue to the caller unless someone else holds it. Reads
// the caller and the current assignee together, then writes only when the issue
// is free. Jira holds one assignee, so a write would replace a colleague's.
export async function assignJiraIssue(
  issueId: string,
): Promise<JiraAssignment> {
  const { issueKey, site } = await resolveJiraTarget(issueId);

  const myselfPath = jiraApiPath(site.deployment, "/myself");
  const assigneePath = jiraApiPath(
    site.deployment,
    `/issue/${issueKey}?fields=assignee`,
  );
  const [myselfResponse, issueResponse] = await Promise.all([
    fetchJira(myselfPath, site),
    fetchJira(assigneePath, site),
  ]);

  if (!myselfResponse.ok) {
    throw await jiraAssignFailure(
      myselfResponse,
      myselfPath,
      issueKey,
      "caller",
      site,
    );
  }

  if (!issueResponse.ok) {
    throw await jiraAssignFailure(
      issueResponse,
      assigneePath,
      issueKey,
      "issue",
      site,
    );
  }

  const me = await readJiraJson<JiraUser>(myselfPath, site, myselfResponse);
  const issue = await readJiraJson<{
    fields?: { assignee?: JiraUser | null };
  }>(assigneePath, site, issueResponse);
  const assignee = issue.fields?.assignee;
  const displayName = me.displayName ?? "you";

  // D8: Cloud goes by accountId. Data Center goes by `key`, which survives a
  // rename, and falls back to `name` only when either side has no `key`.
  const isDataCenter = site.deployment === "datacenter";
  if (isDataCenter ? !me.name : !me.accountId) {
    throw new Error(
      isDataCenter
        ? "Jira: Could not determine the user behind jira.apiToken (a Jira Data Center personal access token)."
        : "Jira: Could not determine the account for jira.email.",
    );
  }

  const isMine = isDataCenter
    ? me.key !== undefined && assignee?.key !== undefined
      ? assignee.key === me.key
      : assignee?.name === me.name
    : assignee?.accountId === me.accountId;

  if (isMine) {
    return { outcome: "already-yours", displayName };
  }

  if (assignee) {
    return {
      outcome: "held-by-other",
      displayName,
      heldBy: assignee.displayName ?? "someone else",
    };
  }

  // Not atomic: someone who takes the issue between the read above and this
  // write is replaced. Jira has no conditional assign, so the window is
  // narrowed, not closed.
  const path = jiraApiPath(site.deployment, `/issue/${issueKey}/assignee`);
  const putResponse = await fetchJira(path, site, {
    method: "PUT",
    body: isDataCenter ? { name: me.name } : { accountId: me.accountId },
  });

  if (!putResponse.ok) {
    throw await jiraAssignFailure(
      putResponse,
      path,
      issueKey,
      "assignee",
      site,
    );
  }

  return { outcome: "assigned", displayName };
}

/** `from` and `to` are status names; `targets` are the names Jira offered. */
export type JiraStart =
  | { outcome: "started"; from: string; to: string }
  | { outcome: "already-started"; status: string }
  | { outcome: "left-alone"; status: string; category: string }
  | { outcome: "no-in-progress-transition"; status: string }
  | { outcome: "ambiguous"; status: string; targets: string[] };

interface JiraStatus {
  id?: string;
  name?: string;
  statusCategory?: { key?: string };
}

interface JiraTransition {
  id?: string;
  name?: string;
  isAvailable?: boolean;
  to?: JiraStatus;
}

// D8: a failed move is named in the person's terms. The messages carry the
// issue key and the API's own text, never a header. `transitionName` is set
// only for the write, whose 400 means the transition's screen wants a field (D4).
async function jiraStartFailure(
  response: Response,
  path: string,
  issueKey: string,
  site: JiraSite,
  transitionName?: string,
): Promise<Error> {
  if (response.status === 401) {
    return jiraAuthFailure(site);
  }

  if (response.status === 404) {
    return new Error(`Jira: Issue ${issueKey} was not found.`);
  }

  const errorMessage = await readJiraBody(path, () => response.text());
  const detail = `${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`;

  if (response.status === 400 && transitionName) {
    return new Error(
      `Jira: Could not move ${issueKey} with the "${transitionName}" transition; it may need a field set in Jira. ${detail}`,
    );
  }

  if (response.status === 409) {
    return new Error(
      `Jira: ${issueKey} was changed while it was being moved. Try again. ${detail}`,
    );
  }

  return new Error(`Jira: Failed to move issue ${issueKey}. ${detail}`);
}

// D1-D7: moves a not-yet-begun issue to the one in-progress status its
// workflow offers. Reads the status first and the transitions only when the
// issue is in the "new" category (D5), then writes only when exactly one
// distinct in-progress target exists (D3). A 204 is success (D6).
export async function startJiraIssue(issueId: string): Promise<JiraStart> {
  const { issueKey, site } = await resolveJiraTarget(issueId);
  const unexpected = () =>
    new Error(`Jira: Unexpected response for ${issueKey}.`);

  const statusPath = jiraApiPath(
    site.deployment,
    `/issue/${issueKey}?fields=status`,
  );
  const statusResponse = await fetchJira(statusPath, site);

  if (!statusResponse.ok) {
    throw await jiraStartFailure(statusResponse, statusPath, issueKey, site);
  }

  const issue = await readJiraJson<{ fields?: { status?: JiraStatus } }>(
    statusPath,
    site,
    statusResponse,
  );
  const current = issue.fields?.status;
  const categoryKey = current?.statusCategory?.key;

  if (!current || typeof categoryKey !== "string") {
    throw unexpected();
  }

  const status = current.name ?? "unknown";

  if (categoryKey === "indeterminate") {
    return { outcome: "already-started", status };
  }

  if (categoryKey !== "new") {
    return { outcome: "left-alone", status, category: categoryKey };
  }

  const transitionsPath = jiraApiPath(
    site.deployment,
    `/issue/${issueKey}/transitions`,
  );
  const transitionsResponse = await fetchJira(transitionsPath, site);

  if (!transitionsResponse.ok) {
    throw await jiraStartFailure(
      transitionsResponse,
      transitionsPath,
      issueKey,
      site,
    );
  }

  const body = await readJiraJson<{ transitions?: unknown }>(
    transitionsPath,
    site,
    transitionsResponse,
  );

  if (!Array.isArray(body.transitions)) {
    throw unexpected();
  }

  const candidates = (body.transitions as JiraTransition[]).filter(
    (transition) =>
      transition.isAvailable !== false &&
      typeof transition.id === "string" &&
      transition.to?.statusCategory?.key === "indeterminate" &&
      transition.to.id !== current.id,
  );
  const targetNames: string[] = [];
  const targetIds = new Set<string | undefined>();

  for (const candidate of candidates) {
    if (!targetIds.has(candidate.to?.id)) {
      targetIds.add(candidate.to?.id);
      targetNames.push(candidate.to?.name ?? "unknown");
    }
  }

  const chosen = candidates[0];

  if (!chosen) {
    return { outcome: "no-in-progress-transition", status };
  }

  if (targetIds.size > 1) {
    return { outcome: "ambiguous", status, targets: targetNames };
  }

  const postResponse = await fetchJira(transitionsPath, site, {
    method: "POST",
    body: { transition: { id: chosen.id } },
  });

  if (!postResponse.ok) {
    throw await jiraStartFailure(
      postResponse,
      transitionsPath,
      issueKey,
      site,
      chosen.name ?? chosen.id,
    );
  }

  return { outcome: "started", from: status, to: targetNames[0] };
}
