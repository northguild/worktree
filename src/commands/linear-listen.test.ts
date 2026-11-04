/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { createHmac } from "node:crypto";
import { Server } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { networkInterfaces } from "node:os";
import * as linear from "../integrations/linear.js";
import { createSessionLedger } from "../integrations/linear-agent.js";
import type { AgentActivityContent } from "../integrations/linear-agent-api.js";
import * as agentApi from "../integrations/linear-agent-api.js";
import type {
  ChildResult,
  SpawnRequest,
} from "../integrations/linear-agent-dispatch.js";
import * as dispatch from "../integrations/linear-agent-dispatch.js";
import * as config from "../lib/config.js";
import { MissingValueError } from "../lib/prompt.js";
import LinearListen, {
  createListener,
  type Listener,
} from "./linear-listen.js";

// Test-owned placeholders, not credentials; neither matches a secret scanner's shape.
const SECRET = "webhook-secret-for-tests";
const TOKEN = "agent-token-for-tests";
const NOW = 1_800_000_000_000;
const MIB = 1024 * 1024;

// The expected signature is Linear's published rule, restated here on purpose
// (https://linear.app/developers/webhooks, "Securing Webhooks"): the hex
// HMAC-SHA256 of the raw body under the signing secret.
function sign(body: Buffer | string, secret = SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    action: "created",
    webhookTimestamp: NOW,
    agentSession: {
      id: "session-1",
      creator: { id: "user-1" },
      issue: { identifier: "ENG-1", team: { key: "ENG" } },
    },
    ...overrides,
  };
}

const STARTED = JSON.stringify({
  branch: "feature/eng-1",
  path: "/work/repo.worktrees/feature/eng-1",
  agent: { prompted: true },
});

describe("linear-listen server", () => {
  let listener: Listener;
  let base: string;
  let activities: AgentActivityContent[];
  let spawns: SpawnRequest[];
  let release: (result: ChildResult) => void;
  let childSettled: boolean;
  let logs: string[];

  function holdChild() {
    return new Promise<ChildResult>((resolve) => {
      release = (result) => {
        childSettled = true;
        resolve(result);
      };
    });
  }

  async function start(
    options: {
      teamKey?: string;
      allowed?: string[];
      child?: boolean;
      drainTimeoutMs?: number;
    } = {},
  ) {
    activities = [];
    spawns = [];
    logs = [];
    childSettled = false;
    listener = createListener({
      secret: SECRET,
      path: "/webhook",
      now: () => NOW,
      drainTimeoutMs: options.drainTimeoutMs,
      log: (line: string) => logs.push(line),
      dispatch: {
        token: TOKEN,
        allowedCreators: options.allowed ?? ["user-1"],
        teamKey: options.teamKey,
        ledger: createSessionLedger(),
        createActivity: async (
          _token: string,
          _session: string,
          content: AgentActivityContent,
        ) => {
          activities.push(content);
        },
        spawnChild: async (request: SpawnRequest) => {
          spawns.push(request);
          if (options.child) {
            return holdChild();
          }
          return { exitCode: 0, stdout: STARTED, timedOut: false };
        },
      },
    });
    await new Promise<void>((resolve) =>
      listener.server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(listener.server.address() as AddressInfo).port}`;
  }

  async function post(
    body: Buffer | string,
    headers: Record<string, string> = { "Linear-Signature": sign(body) },
    path = "/webhook",
  ) {
    return fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: new Uint8Array(Buffer.from(body)),
    });
  }

  async function settle() {
    // Let the dispatch that follows the 200 finish.
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (spawns.length > 0) {
      await vi.waitFor(() => expect(activities.length).toBeGreaterThan(1));
    }
  }

  afterEach(async () => {
    if (release && !childSettled) {
      release({ exitCode: 0, stdout: STARTED, timedOut: false });
    }
    await listener?.shutdown();
  });

  it("answers a GET with 405 and spawns nothing", async () => {
    await start();
    const response = await fetch(`${base}/webhook`);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(spawns).toEqual([]);
  });

  it("answers a bad signature with 401, no activity and no spawn", async () => {
    await start();
    const body = JSON.stringify(event());
    const response = await post(body, {
      "Linear-Signature": sign(body, "some-other-secret"),
    });
    expect(response.status).toBe(401);
    expect(spawns).toEqual([]);
    expect(activities).toEqual([]);
  });

  it("answers a missing signature with 401", async () => {
    await start();
    const response = await post(JSON.stringify(event()), {});
    expect(response.status).toBe(401);
    expect(spawns).toEqual([]);
  });

  it("answers a good signature with 200 and the thought, response sequence", async () => {
    await start();
    const response = await post(JSON.stringify(event()));
    expect(response.status).toBe(200);
    await settle();
    expect(activities.map((activity) => activity.type)).toEqual([
      "thought",
      "response",
    ]);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.argv).toEqual([
      "branch",
      "--linear",
      "ENG-1",
      "--agent-stdin",
      "--json",
      "--yes",
    ]);
  });

  it("sends the 200 before the child resolves", async () => {
    await start({ child: true });
    const response = await post(JSON.stringify(event()));
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(spawns).toHaveLength(1));
    expect(childSettled).toBe(false);
    expect(activities.map((activity) => activity.type)).toEqual(["thought"]);
    release({ exitCode: 0, stdout: STARTED, timedOut: false });
    await vi.waitFor(() =>
      expect(activities.map((activity) => activity.type)).toEqual([
        "thought",
        "response",
      ]),
    );
  });

  it("checks the signature on the raw bytes, not on a decoded copy", async () => {
    await start();
    // 0xFF is not UTF-8: a decode to a string and back would change the bytes,
    // and the signature below covers the bytes as sent.
    const raw = Buffer.concat([
      Buffer.from(`{ "promptContext" : "x`),
      Buffer.from([0xff]),
      Buffer.from(
        `", "action":"created","webhookTimestamp":${NOW},"agentSession":{"id":"s","creator":{"id":"user-1"},"issue":{"identifier":"ENG-2","team":{"key":"ENG"}}} }`,
      ),
    ]);
    const response = await post(raw);
    expect(response.status).toBe(200);
    await settle();
    expect(spawns[0]?.argv).toContain("ENG-2");
  });

  it("answers a body over 1 MiB with 413 even when it is correctly signed", async () => {
    await start();
    const body = Buffer.alloc(MIB + 1, "a");
    const response = await post(body);
    expect(response.status).toBe(413);
    expect(spawns).toEqual([]);
  });

  // #242: the 413 used to be sent while the sender was still writing, and the
  // close that followed reset the connection before the sender read the reply.
  // It lost that race about a fifth of the time, so one request proves little.
  it("delivers the 413 to a sender that is still writing, every time", async () => {
    await start();
    const body = Buffer.alloc(MIB + 1, "a");
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      statuses.push((await post(body)).status);
    }
    expect(statuses).toEqual(Array(40).fill(413));
    expect(spawns).toEqual([]);
  });

  it("answers a chunked body that goes over 1 MiB with 413", async () => {
    await start();
    const chunk = new Uint8Array(64 * 1024).fill(97);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MIB) {
          controller.close();
          return;
        }
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const response = await fetch(`${base}/webhook`, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(response.headers.get("content-length")).toBe("0");
    expect(response.status).toBe(413);
    expect(spawns).toEqual([]);
  });

  it("disconnects an oversized sender that stops writing, with no reply", async () => {
    await start({ drainTimeoutMs: 50 });
    const { port } = listener.server.address() as AddressInfo;
    const socket = connect(port, "127.0.0.1");
    let received = "";
    // The destroy can reach the client mid-write as a reset; `close` follows either way.
    socket.on("error", () => {});
    socket.on("data", (data: Buffer) => {
      received += data.toString("latin1");
    });
    const closed = new Promise<void>((resolve) =>
      socket.on("close", () => resolve()),
    );
    socket.write(
      `POST /webhook HTTP/1.1\r\nHost: 127.0.0.1\r\nLinear-Delivery: stalled-1\r\nContent-Length: ${10 * MIB}\r\n\r\n`,
    );
    socket.write(Buffer.alloc(MIB + 1, "a"));
    await closed;
    expect(received).toBe("");
    expect(logs).toContain(
      "delivery=stalled-1 status=- oversized body not drained",
    );
    expect(spawns).toEqual([]);
  });

  it("accepts a body of exactly 1 MiB past the cap check (it is then judged on its signature)", async () => {
    await start();
    const body = Buffer.alloc(MIB, "a");
    const response = await post(body, { "Linear-Signature": "0".repeat(64) });
    expect(response.status).toBe(401);
  });

  it("answers a signed body that is not JSON with 400 and spawns nothing", async () => {
    await start();
    const response = await post("not json");
    expect(response.status).toBe(400);
    expect(spawns).toEqual([]);
  });

  // Signed means the sender is Linear, and Linear retries a non-2xx and may
  // disable a webhook that keeps failing (https://linear.app/developers/webhooks),
  // so a body the listener does not act on is a 200 and nothing else.
  it.each([
    ["JSON null", "null"],
    ["an array", "[]"],
    ["an event of the wrong shape", JSON.stringify({ action: "created" })],
    [
      "another webhook category",
      JSON.stringify({
        type: "Issue",
        action: "create",
        webhookTimestamp: NOW,
        data: { id: "i", identifier: "ENG-1" },
      }),
    ],
    [
      "an agent session action this listener does not handle",
      JSON.stringify(event({ action: "updated" })),
    ],
    [
      "a session with no issue",
      JSON.stringify(
        event({
          agentSession: { id: "s", creator: { id: "user-1" }, issue: null },
        }),
      ),
    ],
    [
      "an issue identifier that is not a Linear one",
      JSON.stringify(
        event({
          agentSession: {
            id: "s",
            creator: { id: "user-1" },
            issue: { identifier: "--evil", team: { key: "ENG" } },
          },
        }),
      ),
    ],
  ])("answers a signed body that is %s with 200, logs it as ignored, and does nothing", async (_label, body) => {
    await start();
    const response = await post(body);
    expect(response.status).toBe(200);
    await settle();
    expect(spawns).toEqual([]);
    expect(activities).toEqual([]);
    expect(logs.join("\n")).toMatch(/status=200 ignored/);
  });

  it.each([
    ["older", NOW - 61_000],
    ["newer", NOW + 61_000],
  ])("refuses a signed body whose webhookTimestamp is %s than the one-minute window, with 401 (plan §8 step 3; Linear's Securing Webhooks sample)", async (_label, timestamp) => {
    await start();
    const response = await post(
      JSON.stringify(event({ webhookTimestamp: timestamp })),
    );
    expect(response.status).toBe(401);
    expect(spawns).toEqual([]);
  });

  it("judges freshness on the signed body, not on a Linear-Timestamp header", async () => {
    await start();
    const body = JSON.stringify(event({ webhookTimestamp: NOW - 120_000 }));
    const response = await post(body, {
      "Linear-Signature": sign(body),
      "Linear-Timestamp": String(NOW),
    });
    expect(response.status).toBe(401);
    expect(spawns).toEqual([]);
  });

  it("answers another path with 404", async () => {
    await start();
    const body = JSON.stringify(event());
    const response = await post(body, { "Linear-Signature": sign(body) }, "/x");
    expect(response.status).toBe(404);
    expect(spawns).toEqual([]);
  });

  it("answers 200 and spawns nothing for a session of another team", async () => {
    await start({ teamKey: "OPS" });
    const response = await post(JSON.stringify(event()));
    expect(response.status).toBe(200);
    await settle();
    expect(spawns).toEqual([]);
  });

  it("logs one redacted line per delivery id, with the status and without any secret", async () => {
    await start();
    const body = JSON.stringify(event());
    await post(body, {
      "Linear-Signature": sign(body),
      "Linear-Delivery": "delivery-1",
    });
    await settle();
    const lines = logs.filter((line) => line.includes("delivery=delivery-1"));
    expect(lines.filter((line) => line.includes("status=200"))).toHaveLength(1);
    expect(logs.join("\n")).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(TOKEN);
    expect(logs.every((line) => !line.includes("\n"))).toBe(true);
  });

  it("strips anything but id characters from an unsigned delivery header before it is logged", async () => {
    await start();
    const body = JSON.stringify(event());
    await post(body, {
      "Linear-Signature": sign(body, "wrong"),
      "Linear-Delivery":
        "d-1 status=200 forged lin_api_abcdefghijklmnopqrstuvwxyz",
    });
    const joined = logs.join("\n");
    expect(joined).toContain("status=401");
    expect(joined).not.toContain("lin_api_abcdefghijklmnopqrstuvwxyz");
    expect(logs).toHaveLength(1);
  });

  it("binds 127.0.0.1 only", async () => {
    await start();
    expect((listener.server.address() as AddressInfo).address).toBe(
      "127.0.0.1",
    );
    const port = (listener.server.address() as AddressInfo).port;
    const external = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry?.family === "IPv4" && !entry.internal);
    if (external) {
      await expect(
        fetch(`http://${external.address}:${port}/webhook`, {
          signal: AbortSignal.timeout(2000),
        }),
      ).rejects.toThrow();
    }
  });

  it("waits for the child in flight on shutdown", async () => {
    await start({ child: true });
    await post(JSON.stringify(event()));
    await vi.waitFor(() => expect(spawns).toHaveLength(1));

    let finished = false;
    const closing = listener.shutdown().then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(finished).toBe(false);

    release({ exitCode: 0, stdout: STARTED, timedOut: false });
    await closing;
    expect(finished).toBe(true);
    // The response activity was written before shutdown completed.
    expect(activities.map((activity) => activity.type)).toEqual([
      "thought",
      "response",
    ]);
  });

  it("runs a second session's child only after the first one's has finished (plan §4.1)", async () => {
    await start({ child: true });
    await post(JSON.stringify(event()));
    await post(
      JSON.stringify(
        event({
          agentSession: {
            id: "session-2",
            creator: { id: "user-1" },
            issue: { identifier: "ENG-2", team: { key: "ENG" } },
          },
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(activities.filter((a) => a.type === "thought")).toHaveLength(2),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(spawns).toHaveLength(1);

    release({ exitCode: 0, stdout: STARTED, timedOut: false });
    await vi.waitFor(() => expect(spawns).toHaveLength(2));
    expect(spawns[1]?.argv).toContain("ENG-2");
    release({ exitCode: 0, stdout: STARTED, timedOut: false });
    await vi.waitFor(() =>
      expect(activities.filter((a) => a.type === "response")).toHaveLength(2),
    );
  });

  it("on shutdown, finishes the running session and starts none of those waiting", async () => {
    await start({ child: true });
    await post(JSON.stringify(event()));
    await post(
      JSON.stringify(
        event({
          agentSession: {
            id: "session-2",
            creator: { id: "user-1" },
            issue: { identifier: "ENG-2", team: { key: "ENG" } },
          },
        }),
      ),
    );
    await vi.waitFor(() => expect(spawns).toHaveLength(1));

    const closing = listener.shutdown();
    release({ exitCode: 0, stdout: STARTED, timedOut: false });
    await closing;

    expect(spawns).toHaveLength(1);
    expect(activities.map((a) => a.type)).toEqual([
      "thought",
      "thought",
      "response",
      "error",
    ]);
    expect(activities.at(-1)?.body).toMatch(/stopped/);
  });

  it("refuses new connections once shut down", async () => {
    await start();
    await listener.shutdown();
    await expect(fetch(`${base}/webhook`)).rejects.toThrow();
  });
});

describe("linear-listen command", () => {
  let values: Record<string, string>;
  let spawned: SpawnRequest[];
  let logged: string[];
  let errors: string[];

  function build(flags: Record<string, unknown> = {}) {
    const command = new LinearListen([], {
      runCommand: vi.fn(),
    } as unknown as ConstructorParameters<typeof LinearListen>[1]);
    vi.spyOn(command as any, "parse").mockResolvedValue({
      args: {},
      flags: { port: 0, path: "/webhook", ...flags },
    });
    vi.spyOn(command, "log").mockImplementation((line = "") => {
      logged.push(line);
    });
    vi.spyOn(command, "logToStderr").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
    return command;
  }

  beforeEach(() => {
    // Only the clock is faked: the command judges freshness on the real one.
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    values = {
      "linear.agentToken": TOKEN,
      "linear.webhookSecret": SECRET,
      "linear.apiKey": "personal-key-for-tests",
    };
    spawned = [];
    logged = [];
    errors = [];
    vi.spyOn(config, "gitGetConfigValue").mockImplementation(
      async (name) => values[name] ?? "",
    );
    vi.spyOn(agentApi, "getViewerId").mockResolvedValue("app-1");
    vi.spyOn(agentApi, "createAgentActivity").mockResolvedValue();
    vi.spyOn(linear, "fetchLinear").mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { viewer: { id: "owner-1" } } })),
    );
    vi.spyOn(dispatch, "createCliSpawner").mockReturnValue(async (request) => {
      spawned.push(request);
      return { exitCode: 0, stdout: STARTED, timedOut: false };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists every flag", () => {
    expect(Object.keys(LinearListen.flags).sort()).toEqual([
      "path",
      "port",
      "team",
    ]);
    expect(LinearListen.flags.port.default).not.toBe(8787);
  });

  it.each([
    ["linear.agentToken", "the Linear agent token"],
    ["linear.webhookSecret", "the Linear webhook signing secret"],
    ["linear.apiKey", "the Linear API key"],
  ])("exits 2 with missing_value, binds nothing and prints no secret when %s is unset", async (key, value) => {
    delete values[key];
    const listen = vi.spyOn(Server.prototype, "listen");
    const command = build();

    const error = await command.run().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(MissingValueError);
    expect(error).toMatchObject({ value, oclif: { exit: 2 } });
    expect(listen).not.toHaveBeenCalled();
    expect(agentApi.getViewerId).not.toHaveBeenCalled();
    const everything = [...logged, ...errors, (error as Error).message].join(
      "\n",
    );
    for (const secret of [TOKEN, SECRET, "personal-key-for-tests"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("exits 1 without the token in the message when viewer rejects the token", async () => {
    vi.spyOn(agentApi, "getViewerId").mockRejectedValue(
      new Error(
        `Linear: the request was rejected: bad ${TOKEN.replace(/./g, "*")}`,
      ),
    );
    const listen = vi.spyOn(Server.prototype, "listen");
    const error = await build()
      .run()
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ oclif: { exit: 1 } });
    expect(listen).not.toHaveBeenCalled();
  });

  it("refuses a --path that does not start with a slash, with exit 2", async () => {
    const error = await build({ path: "hook" })
      .run()
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ oclif: { exit: 2 } });
  });

  async function runUntilListening(flags: Record<string, unknown> = {}) {
    const done = build(flags).run();
    await vi.waitFor(() =>
      expect(logged.some((line) => line.startsWith("Listening on"))).toBe(true),
    );
    const url = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(logged.join("\n"))?.[0];
    return { done, url: url as string };
  }

  async function deliver(
    url: string,
    creator: string,
    team = "ENG",
    promptContext?: string,
  ) {
    const body = JSON.stringify(
      event({
        webhookTimestamp: NOW,
        promptContext,
        agentSession: {
          id: `s-${creator}-${team}`,
          creator: { id: creator },
          issue: { identifier: "ENG-1", team: { key: team } },
        },
      }),
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { "Linear-Signature": sign(body) },
      body,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return response.status;
  }

  it("with linear.agentAllow unset, allows only the owner of linear.apiKey, and prints the allowed creators but no secret", async () => {
    const { done, url } = await runUntilListening();
    expect(await deliver(url, "owner-1")).toBe(200);
    expect(spawned).toHaveLength(1);
    expect(await deliver(url, "someone-else")).toBe(200);
    expect(spawned).toHaveLength(1);
    expect(logged.join("\n")).toContain("Allowed creators: owner-1");
    expect(logged.join("\n")).not.toContain(TOKEN);
    expect(logged.join("\n")).not.toContain(SECRET);
    process.emit("SIGTERM");
    await done;
  });

  it("with linear.agentAllow set, allows exactly those ids", async () => {
    values["linear.agentAllow"] = "u-a, u-b";
    const { done, url } = await runUntilListening();
    expect(await deliver(url, "owner-1")).toBe(200);
    expect(spawned).toHaveLength(0);
    expect(await deliver(url, "u-b")).toBe(200);
    expect(spawned).toHaveLength(1);
    process.emit("SIGTERM");
    await done;
  });

  it("with linear.agentContext unset, the brief carries no issue text and the start-up says so", async () => {
    const { done, url } = await runUntilListening();
    expect(await deliver(url, "owner-1", "ENG", "ctx-marker-77")).toBe(200);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.stdin).not.toContain("ctx-marker-77");
    expect(logged.join("\n")).toContain("Issue context: off");
    process.emit("SIGTERM");
    await done;
  });

  it("with linear.agentContext true, the brief carries the fenced issue text, which no log line repeats", async () => {
    values["linear.agentContext"] = "true";
    const { done, url } = await runUntilListening();
    expect(await deliver(url, "owner-1", "ENG", "ctx-marker-77")).toBe(200);
    expect(spawned[0]?.stdin).toContain("ctx-marker-77");
    expect(logged.join("\n")).toContain("Issue context: on");
    expect([...logged, ...errors].join("\n")).not.toContain("ctx-marker-77");
    process.emit("SIGTERM");
    await done;
  });

  it.each([
    "false",
    "yes",
    "TRUE",
  ])("treats linear.agentContext %j as off", async (value) => {
    values["linear.agentContext"] = value;
    const { done, url } = await runUntilListening();
    expect(await deliver(url, "owner-1", "ENG", "ctx-marker-77")).toBe(200);
    expect(spawned[0]?.stdin).not.toContain("ctx-marker-77");
    process.emit("SIGTERM");
    await done;
  });

  it("with --team, ignores a session of another team", async () => {
    const { done, url } = await runUntilListening({ team: "ops" });
    expect(await deliver(url, "owner-1", "ENG")).toBe(200);
    expect(spawned).toHaveLength(0);
    expect(await deliver(url, "owner-1", "OPS")).toBe(200);
    expect(spawned).toHaveLength(1);
    expect(logged.join("\n")).toContain("Team: OPS");
    process.emit("SIGTERM");
    await done;
  });

  it("stops without waiting on a second signal", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    let release: (result: ChildResult) => void = () => {};
    vi.spyOn(dispatch, "createCliSpawner").mockReturnValue(
      () =>
        new Promise<ChildResult>((resolve) => {
          release = resolve;
        }),
    );
    const { done, url } = await runUntilListening();
    await deliver(url, "owner-1");
    process.emit("SIGTERM");
    process.emit("SIGTERM");
    expect(exit).toHaveBeenCalledWith(130);
    release({ exitCode: 0, stdout: STARTED, timedOut: false });
    await done;
  });

  it("reports a port in use as exit 1", async () => {
    const first = await runUntilListening();
    const port = new URL(first.url).port;
    const error = await build({ port: Number(port) })
      .run()
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ oclif: { exit: 1 } });
    expect((error as Error).message).toContain("already in use");
    process.emit("SIGTERM");
    await first.done;
  });
});
