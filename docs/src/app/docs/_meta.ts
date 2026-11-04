// Nextra page-order metadata, kept as a record of the old sidebar until the pages are ported.
type MetaRecord = Record<string, string | { title?: string; display?: string }>;

const meta: MetaRecord = {
  index: {
    display: "hidden",
  },
  "getting-started": "Getting Started",
  commands: {
    title: "Commands",
  },
  configuration: "Configuration",
  "project-configuration": "Project Configuration",
  guides: {
    title: "Guides",
  },
  faq: "FAQ",
  changelog: "Changelog",
};

export default meta;
