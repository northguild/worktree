import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSessionLedger,
  isAllowedCreator,
  isTimestampFresh,
  parseAgentSessionEvent,
  verifyWebhookSignature,
  WEBHOOK_REPLAY_WINDOW_MS,
} from "./linear-agent.js";

// RFC 4231 section 4.2 and 4.3, HMAC-SHA-256.
const RFC_CASES = [
  {
    key: Buffer.alloc(20, 0x0b).toString("latin1"),
    data: "Hi There",
    mac: "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
  },
  {
    key: "Jefe",
    data: "what do ya want for nothing?",
    mac: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  },
];

describe("verifyWebhookSignature", () => {
  it.each(RFC_CASES)("accepts the RFC 4231 vector for key $key.length bytes", ({
    key,
    data,
    mac,
  }) => {
    expect(verifyWebhookSignature(data, mac, key)).toBe(true);
    expect(
      verifyWebhookSignature(Buffer.from(data), mac.toUpperCase(), key),
    ).toBe(true);
  });

  it("accepts the hex HMAC of the raw bytes", () => {
    const body = '{"a": 1,  "b":2}\n';
    const sig = createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig, "s3cret")).toBe(true);
  });

  it("refuses an altered byte, a wrong secret and a re-stringified body", () => {
    const { key, data, mac } = RFC_CASES[1];
    expect(verifyWebhookSignature(`${data}!`, mac, key)).toBe(false);
    expect(verifyWebhookSignature(data, mac, "other")).toBe(false);
    expect(verifyWebhookSignature(data, `${mac.slice(0, 63)}0`, key)).toBe(
      false,
    );
  });

  it("refuses malformed headers without throwing", () => {
    const { key, data, mac } = RFC_CASES[1];
    for (const header of [
      "",
      undefined,
      null,
      "zz".repeat(32),
      mac.slice(0, 62),
      `${mac}00`,
      mac.slice(0, 63),
      ` ${mac}`,
    ]) {
      expect(verifyWebhookSignature(data, header, key)).toBe(false);
    }
    expect(verifyWebhookSignature(data, mac, "")).toBe(false);
    expect(verifyWebhookSignature(data, 42 as unknown as string, key)).toBe(
      false,
    );
  });
});

describe("isTimestampFresh", () => {
  const now = 1_676_056_940_508; // Linear-Timestamp in the documented example
  it("uses Linear's documented 60 second window", () => {
    expect(WEBHOOK_REPLAY_WINDOW_MS).toBe(60_000);
  });
  it("accepts inside the window, either direction, and as a header string", () => {
    expect(isTimestampFresh(now, now)).toBe(true);
    expect(isTimestampFresh(now - 60_000, now)).toBe(true);
    expect(isTimestampFresh(now + 60_000, now)).toBe(true);
    expect(isTimestampFresh(String(now - 59_000), now)).toBe(true);
  });
  it("refuses outside the window and non-numbers", () => {
    expect(isTimestampFresh(now - 60_001, now)).toBe(false);
    expect(isTimestampFresh(now + 60_001, now)).toBe(false);
    expect(isTimestampFresh(undefined, now)).toBe(false);
    expect(isTimestampFresh("abc", now)).toBe(false);
    expect(isTimestampFresh(Number.NaN, now)).toBe(false);
    expect(isTimestampFresh(Number.POSITIVE_INFINITY, now)).toBe(false);
  });
});

function event(action: string, identifier = "ENG-12") {
  return {
    action,
    type: "AgentSessionEvent",
    webhookTimestamp: 1_676_056_940_508,
    promptContext: action === "created" ? "<issue/>" : undefined,
    agentSession: {
      id: "sess-1",
      creator: { id: "user-1", name: "ignored" },
      issue: { identifier, team: { id: "t", key: "ENG" } },
    },
    agentActivity: { body: "ignored" },
  };
}

describe("parseAgentSessionEvent", () => {
  it("accepts created and prompted fixtures", () => {
    expect(parseAgentSessionEvent(event("created"))).toEqual({
      action: "created",
      webhookTimestamp: 1_676_056_940_508,
      sessionId: "sess-1",
      creatorId: "user-1",
      issueIdentifier: "ENG-12",
      teamKey: "ENG",
      promptContext: "<issue/>",
    });
    expect(parseAgentSessionEvent(event("prompted"))?.action).toBe("prompted");
  });

  it("treats a missing creator as null", () => {
    const e = event("created");
    (e.agentSession as { creator?: unknown }).creator = null;
    expect(parseAgentSessionEvent(e)?.creatorId).toBeNull();
  });

  it.each([
    "ENG-1; rm -rf",
    "../ENG-1",
    "ENG-1\n",
    "-1",
    "ENG-",
    "ENG 1",
    "",
  ])("refuses identifier %j", (identifier) => {
    expect(parseAgentSessionEvent(event("created", identifier))).toBeNull();
  });

  it("refuses unknown actions and malformed bodies", () => {
    expect(parseAgentSessionEvent(event("deleted"))).toBeNull();
    expect(parseAgentSessionEvent(null)).toBeNull();
    expect(parseAgentSessionEvent("x")).toBeNull();
    expect(parseAgentSessionEvent({ action: "created" })).toBeNull();
  });
});

describe("isAllowedCreator", () => {
  it("allows only listed ids", () => {
    expect(isAllowedCreator("a", ["a", "b"])).toBe(true);
    expect(isAllowedCreator("c", ["a", "b"])).toBe(false);
    expect(isAllowedCreator(null, ["a"])).toBe(false);
    expect(isAllowedCreator(undefined, [])).toBe(false);
  });
});

describe("createSessionLedger", () => {
  it("reports a repeat id as seen", () => {
    const ledger = createSessionLedger(10);
    expect(ledger.seen("a")).toBe(false);
    expect(ledger.seen("a")).toBe(true);
  });
  it("stays under its bound after many distinct ids", () => {
    const ledger = createSessionLedger(50);
    for (let i = 0; i < 10_000; i++) {
      ledger.seen(`s${i}`);
    }
    expect(ledger.size).toBeLessThanOrEqual(50);
    expect(ledger.seen("s9999")).toBe(true);
    expect(ledger.seen("s0")).toBe(false);
  });
});
