import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  // D10: Linear personal API keys have the shape `lin_api_` + token.
  it("replaces a Linear API key in text", () => {
    // Built at runtime: a literal in this shape trips GitHub push protection.
    const key = `lin_api_${"AbCdEf0123".repeat(4)}`;

    const redacted = redactSecrets(`Linear rejected ${key} just now`);

    expect(redacted).toBe("Linear rejected *** just now");
    expect(redacted).not.toContain("lin_api_");
  });

  it("still replaces a GitHub token", () => {
    expect(redactSecrets(`token ghp_${"a".repeat(36)}`)).toBe("token ***");
  });

  it("leaves text without a secret alone", () => {
    expect(redactSecrets("Linear: Unable to find issue ENG-1.")).toBe(
      "Linear: Unable to find issue ENG-1.",
    );
  });
});
