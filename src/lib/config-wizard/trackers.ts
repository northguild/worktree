import { EOL } from "node:os";
import { gitGetConfigValue } from "../config.js";
import { askInput, askSelect } from "../prompt.js";
import { isValidEmail, isValidWorkspaceId } from "../validators.js";
import {
  askConfigInput,
  isJiraDataCenter,
  shouldPrompt,
  type WizardContext,
} from "./context.js";
import { saveConfigValue } from "./written.js";

export async function configureJira(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "jira.host")) {
    // The stored host is the editable default; with none stored there is
    // no default, so Enter cannot write the example host. It stays in the
    // message as a hint only. A non-interactive run takes the stored host
    // and fails on none, because the validator rejects an empty one.
    const jiraHost = await askConfigInput("jira.host", {
      message: "Jira host (for example https://your-domain.atlassian.net)",
      validate: (value) => (value.trim() ? true : "Jira host cannot be empty"),
    });
    await saveConfigValue("jira.host", jiraHost);
  }

  if (shouldPrompt(ctx, "jira.email")) {
    const jiraEmail = await askConfigInput("jira.email", {
      message: "Jira email",
      validate: isValidEmail,
    });
    await saveConfigValue("jira.email", jiraEmail);
  }

  if (shouldPrompt(ctx, "jira.apiToken")) {
    const dataCenter = await isJiraDataCenter();
    // The Data Center steps are Atlassian's "Using Personal Access Tokens".
    const jiraTokenInstructions = dataCenter
      ? [
          "To create your personal access token (Jira 8.14 or later), follow these steps:",
          " - In Jira, select your avatar at the top right, then select 'Profile'",
          " - Select 'Personal access tokens' in the left-hand menu",
          " - Select 'Create token'",
          " - Give your token a name, and optionally an expiry",
          " - Select 'Create' and copy your new token",
        ]
      : [
          "To find or create your token, follow these steps:",
          " - Go to https://id.atlassian.com/manage-profile/security/api-tokens",
          " - Click 'Create API token'",
          " - Give your token a name and expiration date.",
          " - Copy your new token",
        ];

    ctx.log(jiraTokenInstructions.join(EOL) + EOL);
    const jiraApiToken = await askInput(
      {
        message: dataCenter ? "Jira personal access token" : "Jira API token",
      },
      {
        value: "jira.apiToken",
        flag: "worktree config jira.apiToken <token>",
        // The stored token if there is one, never an empty one.
        fallback: (await gitGetConfigValue("jira.apiToken")) || undefined,
      },
    );
    // Only a real answer is written, as with `github.token`: a bare
    // `worktree config` prompts every key whatever it already holds, so an
    // empty (or whitespace-only) answer keeps the stored token instead of
    // clearing it.
    if (jiraApiToken.trim()) {
      await saveConfigValue("jira.apiToken", jiraApiToken.trim());
    }
  }

  if (shouldPrompt(ctx, "jira.autoAssign")) {
    // Same shape as `github.autoAssign` (D7): anything but an explicit
    // "true" or "false" is normalised to the "ask me" choice.
    const storedJiraAutoAssign = await gitGetConfigValue("jira.autoAssign");
    const jiraAutoAssignDefault =
      storedJiraAutoAssign === "true" || storedJiraAutoAssign === "false"
        ? storedJiraAutoAssign
        : "";
    const jiraAutoAssign = await askSelect<"true" | "false" | "">(
      {
        message: "Should `branch --jira` assign the issue to you?",
        choices: [
          { name: "Yes, always", value: "true" },
          { name: "No, never", value: "false" },
          // Tri-state through unset (D3): this is also the way to keep
          // being asked at branch time.
          { name: "Ask me each time", value: "" },
        ],
        default: jiraAutoAssignDefault,
      },
      {
        value: "jira.autoAssign",
        flag: "worktree config jira.autoAssign <true|false>",
        fallback: jiraAutoAssignDefault,
      },
    );
    await saveConfigValue("jira.autoAssign", jiraAutoAssign);
  }

  if (shouldPrompt(ctx, "jira.autoStart")) {
    // Same shape as `clickup.autoStart` (D9): anything but an explicit
    // "true" or "false" is normalised to the "ask me" choice.
    const storedJiraAutoStart = await gitGetConfigValue("jira.autoStart");
    const jiraAutoStartDefault =
      storedJiraAutoStart === "true" || storedJiraAutoStart === "false"
        ? storedJiraAutoStart
        : "";
    const jiraAutoStart = await askSelect<"true" | "false" | "">(
      {
        message:
          "Should `branch --jira` move the issue to in progress once the worktree exists?",
        choices: [
          { name: "Yes, always", value: "true" },
          { name: "No, never", value: "false" },
          // Tri-state through unset: also the way to keep being asked.
          { name: "Ask me each time", value: "" },
        ],
        default: jiraAutoStartDefault,
      },
      {
        value: "jira.autoStart",
        flag: "worktree config jira.autoStart <true|false>",
        fallback: jiraAutoStartDefault,
      },
    );
    await saveConfigValue("jira.autoStart", jiraAutoStart);
  }
}

// Both GitHub keys are one checklist item, in the shape the Jira and Herdr
// groups use. `github.token` had no block at all until this group existed:
// it was in CONFIG_NAMES, so `--missing` listed it as missing and then
// prompted nothing. A key without a block is a key that cannot be answered
// here, which is the dead shape `github.autoAssign` would have inherited.
export async function configureGithub(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "github.token")) {
    const githubTokenInstructions = [
      "To find or create your token, follow these steps:",
      " - Go to https://github.com/settings/personal-access-tokens/new",
      " - Give the token access to the repositories you use worktree with",
      " - Copy your new token",
      "Leave this empty to let `gh auth token` supply one instead.",
      "The stored token is used for github.com only; a GitHub Enterprise host's token is read from `gh auth token --hostname <host>`.",
    ];

    ctx.log(githubTokenInstructions.join(EOL) + EOL);
    // No default and no prefill, exactly as `jira.apiToken` is asked: a
    // token is not echoed back as a prompt default.
    const githubToken = await askInput(
      { message: "GitHub personal access token" },
      {
        value: "github.token",
        flag: "worktree config github.token <token>",
        fallback: (await gitGetConfigValue("github.token")) || undefined,
      },
    );
    // Only a real answer is written. The instruction line above invites an
    // empty one — it is how you say "use `gh auth token` instead" — and an
    // unconditional write would make taking that invitation clear a stored
    // PAT, on a bare `worktree config` that prompts every key whatever it
    // already holds. An answer of only spaces is that same answer: the
    // prompt does not trim, and a stored whitespace token reads back as
    // unset, so it is judged and written trimmed.
    if (githubToken.trim()) {
      await saveConfigValue("github.token", githubToken.trim());
    }
  }

  if (shouldPrompt(ctx, "github.autoAssign")) {
    // Select values are compared with `===`, so anything but an explicit
    // "true" or "false" (unset, empty, a hand-edited oddity) is normalised
    // to the "ask me" choice before it becomes the default or the fallback.
    const storedAutoAssign = await gitGetConfigValue("github.autoAssign");
    const autoAssignDefault =
      storedAutoAssign === "true" || storedAutoAssign === "false"
        ? storedAutoAssign
        : "";
    const githubAutoAssign = await askSelect<"true" | "false" | "">(
      {
        message: "Should `branch --github` assign the issue to you?",
        choices: [
          { name: "Yes, always", value: "true" },
          { name: "No, never", value: "false" },
          // Empty is a valid answer as well as a valid state: the key is
          // tri-state through unset (D3), so this prompt has to be the way
          // to keep being asked at branch time, not only the way to settle it.
          { name: "Ask me each time", value: "" },
        ],
        default: autoAssignDefault,
      },
      {
        value: "github.autoAssign",
        flag: "worktree config github.autoAssign <true|false>",
        fallback: autoAssignDefault,
      },
    );
    await saveConfigValue("github.autoAssign", githubAutoAssign);
  }
}

// The key and the start select. Like the
// Jira group, nothing is validated against Linear here: the key is checked when
// `branch --linear` first uses it.
export async function configureLinear(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "linear.apiKey")) {
    const linearKeyInstructions = [
      "To find or create your key, follow these steps:",
      " - Go to Linear -> Settings -> Security & access -> Personal API keys",
      " - Click 'New API key' and give it a label",
      " - Copy your new key",
    ];

    ctx.log(linearKeyInstructions.join(EOL) + EOL);
    // No default and no prefill, exactly as `jira.apiToken` is asked: a
    // key is not echoed back as a prompt default.
    const linearApiKey = await askInput(
      { message: "Linear API key" },
      {
        value: "linear.apiKey",
        flag: "worktree config linear.apiKey <key>",
        // The stored key if there is one, never an empty one.
        fallback: (await gitGetConfigValue("linear.apiKey")) || undefined,
      },
    );
    // Only a real answer is written, as with `github.token`: a bare
    // `worktree config` prompts every key whatever it already holds, so an
    // empty answer keeps the stored key instead of clearing it.
    if (linearApiKey.trim()) {
      await saveConfigValue("linear.apiKey", linearApiKey.trim());
    }
  }

  if (shouldPrompt(ctx, "linear.autoStart")) {
    // Same shape as `github.autoAssign` (D10): anything but an explicit
    // "true" or "false" is normalised to the "ask me" choice.
    const storedLinearAutoStart = await gitGetConfigValue("linear.autoStart");
    const linearAutoStartDefault =
      storedLinearAutoStart === "true" || storedLinearAutoStart === "false"
        ? storedLinearAutoStart
        : "";
    const linearAutoStart = await askSelect<"true" | "false" | "">(
      {
        message:
          "Should `branch --linear` move the issue to started once the worktree exists?",
        choices: [
          { name: "Yes, always", value: "true" },
          { name: "No, never", value: "false" },
          // Tri-state through unset (D4): also the way to keep being asked.
          { name: "Ask me each time", value: "" },
        ],
        default: linearAutoStartDefault,
      },
      {
        value: "linear.autoStart",
        flag: "worktree config linear.autoStart <true|false>",
        fallback: linearAutoStartDefault,
      },
    );
    await saveConfigValue("linear.autoStart", linearAutoStart);
  }
}

// Four keys. The token is required and secret, so it is asked
// like `linear.apiKey`; the workspace id matters only to a custom task id
// and most Workspaces have those off, so an empty answer skips it (as
// `herdr.agent` and `postCreate` accept empty) and a non-interactive run
// takes that empty default instead of failing. The assign and start selects
// come last, shaped like Jira's. Nothing is validated against ClickUp here: the
// token is checked when `branch --clickup` first uses it.
export async function configureClickUp(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "clickup.apiToken")) {
    const clickUpTokenInstructions = [
      "To find your personal API token, follow these steps:",
      " - Go to ClickUp -> your avatar -> Settings -> Apps -> API Token",
      " - Click 'Generate' (or 'Regenerate') and copy the token",
    ];

    ctx.log(clickUpTokenInstructions.join(EOL) + EOL);
    // No default and no prefill, exactly as `jira.apiToken` is asked: a
    // token is not echoed back as a prompt default.
    const clickUpApiToken = await askInput(
      { message: "ClickUp API token" },
      {
        value: "clickup.apiToken",
        flag: "worktree config clickup.apiToken <token>",
        // The stored token if there is one, never an empty one.
        fallback: (await gitGetConfigValue("clickup.apiToken")) || undefined,
      },
    );
    // Only a real answer is written: an empty answer keeps the stored
    // token instead of clearing it.
    if (clickUpApiToken.trim()) {
      await saveConfigValue("clickup.apiToken", clickUpApiToken.trim());
    }
  }

  if (shouldPrompt(ctx, "clickup.workspaceId")) {
    const clickUpWorkspaceId = await askConfigInput("clickup.workspaceId", {
      message:
        "ClickUp workspace id (only for custom task ids like DEV-123; empty to skip)",
      validate: (value: string) =>
        value.trim() === "" || isValidWorkspaceId(value.trim()),
    });
    // Empty skips the key rather than writing an empty value.
    if (clickUpWorkspaceId.trim()) {
      await saveConfigValue("clickup.workspaceId", clickUpWorkspaceId.trim());
    }
  }

  if (shouldPrompt(ctx, "clickup.autoAssign")) {
    // Same shape as `jira.autoAssign` (D10): anything but an explicit
    // "true" or "false" is normalised to the "ask me" choice.
    const storedClickUpAutoAssign =
      await gitGetConfigValue("clickup.autoAssign");
    const clickUpAutoAssignDefault =
      storedClickUpAutoAssign === "true" || storedClickUpAutoAssign === "false"
        ? storedClickUpAutoAssign
        : "";
    const clickUpAutoAssign = await askSelect<"true" | "false" | "">(
      {
        message: "Should `branch --clickup` assign the task to you?",
        choices: [
          { name: "Yes, always", value: "true" },
          { name: "No, never", value: "false" },
          // Tri-state through unset (D4): also the way to keep being asked.
          { name: "Ask me each time", value: "" },
        ],
        default: clickUpAutoAssignDefault,
      },
      {
        value: "clickup.autoAssign",
        flag: "worktree config clickup.autoAssign <true|false>",
        fallback: clickUpAutoAssignDefault,
      },
    );
    await saveConfigValue("clickup.autoAssign", clickUpAutoAssign);
  }

  if (shouldPrompt(ctx, "clickup.autoStart")) {
    // Same shape as `linear.autoStart` (D10): anything but an explicit
    // "true" or "false" is normalised to the "ask me" choice.
    const storedClickUpAutoStart = await gitGetConfigValue("clickup.autoStart");
    const clickUpAutoStartDefault =
      storedClickUpAutoStart === "true" || storedClickUpAutoStart === "false"
        ? storedClickUpAutoStart
        : "";
    const clickUpAutoStart = await askSelect<"true" | "false" | "">(
      {
        message:
          "Should `branch --clickup` move the task to in progress once the worktree exists?",
        choices: [
          { name: "Yes, always", value: "true" },
          { name: "No, never", value: "false" },
          // Tri-state through unset (D4): also the way to keep being asked.
          { name: "Ask me each time", value: "" },
        ],
        default: clickUpAutoStartDefault,
      },
      {
        value: "clickup.autoStart",
        flag: "worktree config clickup.autoStart <true|false>",
        fallback: clickUpAutoStartDefault,
      },
    );
    await saveConfigValue("clickup.autoStart", clickUpAutoStart);
  }
}
