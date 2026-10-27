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

  // D10: ClickUp personal tokens start `pk_`; the layout after it is not relied on.
  it("replaces a ClickUp personal token in text", () => {
    const token = `pk_${"AbCdEf0123".repeat(3)}`;

    const redacted = redactSecrets(`ClickUp rejected ${token} just now`);

    expect(redacted).toBe("ClickUp rejected *** just now");
    expect(redacted).not.toContain("pk_");
  });

  it("replaces a ClickUp token that carries a user id and underscores", () => {
    expect(redactSecrets(`token pk_12345678_${"A1".repeat(16)}`)).toBe(
      "token ***",
    );
  });

  it("leaves a short pk_ word alone", () => {
    expect(redactSecrets("see pk_short and pk_id")).toBe(
      "see pk_short and pk_id",
    );
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
