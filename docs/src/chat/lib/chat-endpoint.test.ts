import { brainsEndpoint, chatEndpoint } from "./chat-endpoint";

// Expected values: plan #257 D11 -- PUBLIC_GEMINI_WORKER_URL joined to /api/chat with one slash, falling back to
// http://localhost:8787 when unset (as the retired client did). The route is /api/chat per §4.2.
describe("chatEndpoint", () => {
  it.each([
    ["https://w.example", "https://w.example/api/chat"],
    ["https://w.example/", "https://w.example/api/chat"],
    ["https://w.example///", "https://w.example/api/chat"],
  ])("joins %s to /api/chat with one slash", (base, expected) => {
    expect(chatEndpoint(base)).toBe(expected);
  });

  it.each([
    undefined,
    "",
  ])("falls back to the local Worker when the URL is %j", (base) => {
    expect(chatEndpoint(base)).toBe("http://localhost:8787/api/chat");
  });
});

// Expected values: plan #309 D10 (the badge reads `GET /api/brains`) and docs/worker/README.md's route table: the same Worker
// as `/api/chat`, so the same base URL, one slash and local fallback.
describe("brainsEndpoint", () => {
  it.each([
    ["https://w.example", "https://w.example/api/brains"],
    ["https://w.example/", "https://w.example/api/brains"],
    ["https://w.example///", "https://w.example/api/brains"],
  ])("joins %s to /api/brains with one slash", (base, expected) => {
    expect(brainsEndpoint(base)).toBe(expected);
  });

  it.each([
    undefined,
    "",
  ])("falls back to the local Worker when the URL is %j", (base) => {
    expect(brainsEndpoint(base)).toBe("http://localhost:8787/api/brains");
  });
});
