// Nextra page-order metadata, kept as a record of the old sidebar until the pages are ported.
type MetaRecord = Record<string, string | { title?: string; display?: string }>;

const meta: MetaRecord = {
  "github-issue-integration": "GitHub Issue Integration",
  "jira-integration": "Jira Issue Integration",
  "linear-integration": "Linear Issue Integration",
  "clickup-integration": "ClickUp Task Integration",
  "context-switching": "Context Switching",
  "team-conventions": "Team Conventions",
  "env-files": "Environment Files",
  "editor-integration": "Editor Integration",
  "herdr-spaces": "Herdr Spaces",
};

export default meta;
