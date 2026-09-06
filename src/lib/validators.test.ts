import * as cli from "./cli.js";
import * as git from "./git.js";
import {
  isValidBranch,
  isValidBranchName,
  isValidCommand,
  isValidCommandLine,
  isValidConfigValue,
  isValidEmail,
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

describe("isValidCommandLine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each`
    commandLine       | commandExists | expected                     | lookedUp    | description
    ${"claude"}       | ${true}       | ${true}                      | ${"claude"} | ${"a bare program name"}
    ${"claude --bg"}  | ${true}       | ${true}                      | ${"claude"} | ${"leading arguments are not part of the lookup"}
    ${"  codex  -q "} | ${true}       | ${true}                      | ${"codex"}  | ${"surrounding whitespace is trimmed"}
    ${"codex\t-q"}    | ${true}       | ${true}                      | ${"codex"}  | ${"a tab separates the head just as a space does"}
    ${"nope --bg"}    | ${false}      | ${"Command not found: nope"} | ${"nope"}   | ${"the error names the program, not the whole line"}
    ${"nope"}         | ${false}      | ${"Command not found: nope"} | ${"nope"}   | ${"a missing bare program"}
  `(
    'should return $expected for "$commandLine" ($description)',
    async ({ commandLine, commandExists, expected, lookedUp }) => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(commandExists);

      expect(await isValidCommandLine(commandLine)).toBe(expected);
      expect(cli.commandExists).toHaveBeenCalledWith(lookedUp);
    },
  );

  it.each`
    commandLine | description
    ${""}       | ${"empty string"}
    ${"   "}    | ${"whitespace only"}
  `(
    'should reject "$commandLine" without a lookup ($description)',
    async ({ commandLine }) => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(true);

      expect(await isValidCommandLine(commandLine)).toBe(
        "Command cannot be empty",
      );
      expect(cli.commandExists).not.toHaveBeenCalled();
    },
  );
});

describe("isValidConfigValue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // agent.command routes to isValidCommandLine rather than isValidCommand, so a
  // configured value carrying flags validates on its head alone. Pinning the
  // routing here is what keeps a switch edit from silently reverting D1.
  it("validates agent.command on its argv head", async () => {
    vi.spyOn(cli, "commandExists").mockResolvedValue(true);

    expect(await isValidConfigValue("agent.command", "claude --bg")).toBe(true);
    expect(cli.commandExists).toHaveBeenCalledWith("claude");
  });

  it("reports only the program when agent.command's head is missing", async () => {
    vi.spyOn(cli, "commandExists").mockResolvedValue(false);

    expect(await isValidConfigValue("agent.command", "nope --bg")).toBe(
      "Command not found: nope",
    );
  });

  it("leaves a config name with no case unvalidated", async () => {
    vi.spyOn(cli, "commandExists").mockResolvedValue(false);

    expect(await isValidConfigValue("github.token", "anything at all")).toBe(
      true,
    );
    expect(cli.commandExists).not.toHaveBeenCalled();
  });
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
