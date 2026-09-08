import * as cli from "./cli.js";
import * as git from "./git.js";
import {
  InvalidConfigValueError,
  isValidAgentKind,
  isValidBoolean,
  isValidBranch,
  isValidBranchName,
  isValidCommand,
  isValidConfigValue,
  isValidEmail,
  isValidOpener,
  validateConfigValue,
} from "./validators.js";

describe("isValidEmail", () => {
  it.each`
    email                             | expected                   | description
    ${"user@example.com"}             | ${true}                    | ${"valid basic email"}
    ${"test.email@domain.co.uk"}      | ${true}                    | ${"valid email with dots and co.uk"}
    ${"user+tag@example.org"}         | ${true}                    | ${"valid email with plus sign"}
    ${"user_name@example.net"}        | ${true}                    | ${"valid email with underscore"}
    ${"123@example.com"}              | ${true}                    | ${"valid email with numbers"}
    ${"user-name@example-site.com"}   | ${true}                    | ${"valid email with hyphens"}
    ${"a@b.co"}                       | ${true}                    | ${"valid minimal email"}
    ${"user@subdomain.example.com"}   | ${true}                    | ${"valid email with subdomain"}
    ${"user@example.info"}            | ${true}                    | ${"valid email with .info tld"}
    ${"plainaddress"}                 | ${"Invalid email address"} | ${"missing @ symbol"}
    ${"@example.com"}                 | ${"Invalid email address"} | ${"missing local part"}
    ${"user@"}                        | ${"Invalid email address"} | ${"missing domain"}
    ${"user..double.dot@example.com"} | ${true}                    | ${"double dots in local part (allowed by current regex)"}
    ${"user@.example.com"}            | ${true}                    | ${"domain starts with dot (allowed by current regex)"}
    ${"user@example."}                | ${"Invalid email address"} | ${"domain ends with dot"}
    ${"user@com"}                     | ${"Invalid email address"} | ${"missing top-level domain"}
    ${"user name@example.com"}        | ${"Invalid email address"} | ${"space in local part"}
    ${"user@example com"}             | ${"Invalid email address"} | ${"space in domain"}
    ${""}                             | ${"Invalid email address"} | ${"empty string"}
    ${"user@@example.com"}            | ${"Invalid email address"} | ${"double @ symbol"}
    ${"user@example..com"}            | ${true}                    | ${"double dots in domain (allowed by current regex)"}
  `(
    'should return $expected for "$email" ($description)',
    ({ email, expected }) => {
      expect(isValidEmail(email)).toBe(expected);
    },
  );
});

describe("isValidCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each`
    command                    | commandExists | expected                                      | description
    ${"git"}                   | ${true}       | ${true}                                       | ${"existing command"}
    ${"node"}                  | ${true}       | ${true}                                       | ${"another existing command"}
    ${"git status"}            | ${true}       | ${true}                                       | ${"command with arguments"}
    ${"nonexistent"}           | ${false}      | ${"Command not found: nonexistent"}           | ${"non-existing command"}
    ${"fake-cmd"}              | ${false}      | ${"Command not found: fake-cmd"}              | ${"another non-existing command"}
    ${"bad command with args"} | ${false}      | ${"Command not found: bad command with args"} | ${"non-existing command with args"}
  `(
    'should return $expected for "$command" when commandExists returns $commandExists ($description)',
    async ({ command, commandExists, expected }) => {
      // Mock the commandExists function
      vi.spyOn(cli, "commandExists").mockResolvedValue(commandExists);

      expect(await isValidCommand(command)).toBe(expected);
      expect(cli.commandExists).toHaveBeenCalledWith(command);
    },
  );
});

describe("isValidBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console.log to avoid cluttering test output
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it.each`
    branch                   | branchType  | availableBranches                                           | expected                                  | description
    ${"main"}                | ${"local"}  | ${["main", "develop", "feature/test"]}                      | ${true}                                   | ${"existing local branch"}
    ${"develop"}             | ${"local"}  | ${["main", "develop", "feature/test"]}                      | ${true}                                   | ${"another existing local branch"}
    ${"feature/test"}        | ${"local"}  | ${["main", "develop", "feature/test"]}                      | ${true}                                   | ${"local branch with slash"}
    ${"nonexistent"}         | ${"local"}  | ${["main", "develop", "feature/test"]}                      | ${"Branch not found: nonexistent"}        | ${"non-existing local branch"}
    ${"origin/main"}         | ${"remote"} | ${["origin/main", "origin/develop", "origin/feature/test"]} | ${true}                                   | ${"existing remote branch"}
    ${"origin/develop"}      | ${"remote"} | ${["origin/main", "origin/develop", "origin/feature/test"]} | ${true}                                   | ${"another existing remote branch"}
    ${"origin/feature/test"} | ${"remote"} | ${["origin/main", "origin/develop", "origin/feature/test"]} | ${true}                                   | ${"remote branch with slash"}
    ${"origin/nonexistent"}  | ${"remote"} | ${["origin/main", "origin/develop", "origin/feature/test"]} | ${"Branch not found: origin/nonexistent"} | ${"non-existing remote branch"}
    ${"upstream/main"}       | ${"remote"} | ${["origin/main", "origin/develop"]}                        | ${"Branch not found: upstream/main"}      | ${"different remote prefix"}
  `(
    'should return $expected for "$branch" when $branchType branches are $availableBranches ($description)',
    async ({ branch, branchType, availableBranches, expected }) => {
      if (branchType === "local") {
        vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(
          availableBranches,
        );
        vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([]);
      } else {
        vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(
          availableBranches,
        );
        vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([]);
      }

      const result = await isValidBranch(branch);
      expect(result).toBe(expected);

      if (branch.startsWith("origin/")) {
        expect(git.gitGetRemoteBranches).toHaveBeenCalled();
        expect(git.gitGetLocalBranches).not.toHaveBeenCalled();
      } else {
        expect(git.gitGetLocalBranches).toHaveBeenCalled();
        expect(git.gitGetRemoteBranches).not.toHaveBeenCalled();
      }
    },
  );
});

describe("isValidBranchName", () => {
  it.each`
    branchName               | expected                                            | description
    ${"main"}                | ${true}                                             | ${"valid simple branch name"}
    ${"feature/new-feature"} | ${true}                                             | ${"valid branch with slash"}
    ${"bugfix/fix-123"}      | ${true}                                             | ${"valid branch with numbers"}
    ${"release/v1.0.0"}      | ${true}                                             | ${"valid release branch"}
    ${"user/john-doe"}       | ${true}                                             | ${"valid branch with hyphens"}
    ${"feature_branch"}      | ${true}                                             | ${"valid branch with underscores"}
    ${"123-branch"}          | ${true}                                             | ${"valid branch starting with numbers"}
    ${""}                    | ${"Branch name cannot be empty"}                    | ${"empty string"}
    ${"   "}                 | ${"Branch name cannot be empty"}                    | ${"whitespace only"}
    ${".hidden"}             | ${"Branch name cannot start with a dot"}            | ${"starts with dot"}
    ${"feature..branch"}     | ${"Branch name cannot contain double dots"}         | ${"contains double dots"}
    ${"branch.."}            | ${"Branch name cannot end with double dots"}        | ${"ends with double dots"}
    ${"feature branch"}      | ${"Branch name cannot contain spaces"}              | ${"contains spaces"}
    ${"branch~1"}            | ${"Branch name contains invalid characters"}        | ${"contains tilde"}
    ${"branch^master"}       | ${"Branch name contains invalid characters"}        | ${"contains caret"}
    ${"branch:colon"}        | ${"Branch name contains invalid characters"}        | ${"contains colon"}
    ${"branch\\backslash"}   | ${"Branch name contains invalid characters"}        | ${"contains backslash"}
    ${"branch*star"}         | ${"Branch name contains invalid characters"}        | ${"contains asterisk"}
    ${"branch?question"}     | ${"Branch name contains invalid characters"}        | ${"contains question mark"}
    ${"branch[bracket"}      | ${"Branch name contains invalid characters"}        | ${"contains bracket"}
    ${"branch@at"}           | ${"Branch name contains invalid characters"}        | ${"contains at sign"}
    ${"branch."}             | ${"Branch name cannot end with a dot"}              | ${"ends with dot"}
    ${"branch/"}             | ${"Branch name cannot end with a slash"}            | ${"ends with slash"}
    ${"feature//double"}     | ${"Branch name cannot contain consecutive slashes"} | ${"consecutive slashes"}
    ${"/starts-slash"}       | ${"Branch name cannot start with a slash"}          | ${"starts with slash"}
    ${"branch.lock"}         | ${"Branch name cannot end with '.lock'"}            | ${"ends with .lock"}
  `(
    'should return $expected for "$branchName" ($description)',
    ({ branchName, expected }) => {
      const result = isValidBranchName(branchName);
      expect(result).toBe(expected);
    },
  );
});

describe("isValidOpener", () => {
  it.each`
    opener      | expected                            | description
    ${"editor"} | ${true}                             | ${"the default opener"}
    ${"herdr"}  | ${true}                             | ${"the Herdr opener"}
    ${"bogus"}  | ${"Opener must be editor or herdr"} | ${"an unknown opener"}
    ${"Editor"} | ${"Opener must be editor or herdr"} | ${"the right kind in the wrong case"}
    ${""}       | ${"Opener must be editor or herdr"} | ${"empty string"}
    ${"herdr "} | ${"Opener must be editor or herdr"} | ${"a trailing space"}
  `(
    'should return $expected for "$opener" ($description)',
    ({ opener, expected }) => {
      expect(isValidOpener(opener)).toBe(expected);
    },
  );
});

describe("isValidBoolean", () => {
  it.each`
    value      | expected                         | description
    ${"true"}  | ${true}                          | ${"true"}
    ${"false"} | ${true}                          | ${"false"}
    ${"yes"}   | ${"Value must be true or false"} | ${"a truthy word that is not true"}
    ${"1"}     | ${"Value must be true or false"} | ${"a numeric flag"}
    ${"True"}  | ${"Value must be true or false"} | ${"the right word in the wrong case"}
    ${""}      | ${"Value must be true or false"} | ${"empty string"}
  `(
    'should return $expected for "$value" ($description)',
    ({ value, expected }) => {
      expect(isValidBoolean(value)).toBe(expected);
    },
  );
});

describe("isValidAgentKind", () => {
  const shapeMessage =
    "Agent kind must be lowercase letters, digits and dashes, for example claude";

  it.each`
    value              | expected        | description
    ${"claude"}        | ${true}         | ${"a kind Herdr lists"}
    ${"codex"}         | ${true}         | ${"another kind Herdr lists"}
    ${"qodercli"}      | ${true}         | ${"a kind with digits-free letters only"}
    ${"some-agent2"}   | ${true}         | ${"kebab with a trailing digit"}
    ${"not-a-kind"}    | ${true}         | ${"a well-shaped kind Herdr does not list, which Herdr rejects, not us (D10)"}
    ${""}              | ${shapeMessage} | ${"empty string"}
    ${"Claude"}        | ${shapeMessage} | ${"the right kind in the wrong case"}
    ${"2fast"}         | ${shapeMessage} | ${"a leading digit"}
    ${"claude code"}   | ${shapeMessage} | ${"a space"}
    ${"claude;rm -rf"} | ${shapeMessage} | ${"shell punctuation"}
    ${"claude_code"}   | ${shapeMessage} | ${"an underscore, which is not kebab"}
  `(
    'should return $expected for "$value" ($description)',
    ({ value, expected }) => {
      expect(isValidAgentKind(value)).toBe(expected);
    },
  );

  it("does not check the value against a list of known kinds", async () => {
    // D10: the 22 kinds live in Herdr's help text and behind
    // `server.agent_manifests`, not in the socket schema, so a copy here would
    // rot on the next release. Shape is all this file is allowed to know.
    expect(isValidAgentKind("an-agent-invented-tomorrow")).toBe(true);
  });
});

describe("isValidConfigValue", () => {
  it.each`
    configName        | value         | expected                                                                         | description
    ${"opener"}       | ${"herdr"}    | ${true}                                                                          | ${"a known opener"}
    ${"opener"}       | ${"bogus"}    | ${"Opener must be editor or herdr"}                                              | ${"an unknown opener"}
    ${"herdr.focus"}  | ${"false"}    | ${true}                                                                          | ${"a boolean focus value"}
    ${"herdr.focus"}  | ${"maybe"}    | ${"Value must be true or false"}                                                 | ${"a non-boolean focus value"}
    ${"herdr.agent"}  | ${"claude"}   | ${true}                                                                          | ${"a well-shaped agent kind"}
    ${"herdr.agent"}  | ${"Claude!"}  | ${"Agent kind must be lowercase letters, digits and dashes, for example claude"} | ${"a badly-shaped agent kind"}
    ${"github.token"} | ${"anything"} | ${true}                                                                          | ${"a key with no validation case"}
  `(
    'should return $expected for $configName="$value" ($description)',
    async ({ configName, value, expected }) => {
      expect(await isValidConfigValue(configName, value)).toBe(expected);
    },
  );
});

describe("validateConfigValue", () => {
  it("should throw InvalidConfigValueError for an unknown opener", async () => {
    await expect(validateConfigValue("opener", "bogus")).rejects.toThrow(
      InvalidConfigValueError,
    );
  });

  it("should resolve for a known opener", async () => {
    await expect(
      validateConfigValue("opener", "herdr"),
    ).resolves.toBeUndefined();
  });

  it("should throw InvalidConfigValueError for a non-boolean herdr.focus", async () => {
    await expect(validateConfigValue("herdr.focus", "maybe")).rejects.toThrow(
      InvalidConfigValueError,
    );
  });

  it("should throw InvalidConfigValueError for a badly-shaped herdr.agent", async () => {
    await expect(validateConfigValue("herdr.agent", "Claude!")).rejects.toThrow(
      InvalidConfigValueError,
    );
  });

  it("should resolve for a well-shaped herdr.agent", async () => {
    await expect(
      validateConfigValue("herdr.agent", "claude"),
    ).resolves.toBeUndefined();
  });
});
