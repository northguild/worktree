// Nextra page-order metadata, kept as a record of the old sidebar until the pages are ported.
type MetaRecord = Record<string, string | { title?: string; display?: string }>;

const meta: MetaRecord = {
  branch: "branch",
  checkout: "checkout",
  config: "config",
  list: "list",
  open: "open",
  remove: "remove",
  cleanup: "cleanup",
};

export default meta;
