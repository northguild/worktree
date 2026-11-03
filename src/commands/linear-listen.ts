import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Flags } from "@oclif/core";
import { fetchLinear } from "../integrations/linear.js";
import {
  createSessionLedger,
  isTimestampFresh,
  parseAgentSessionEvent,
  verifyWebhookSignature,
} from "../integrations/linear-agent.js";
import {
  createAgentActivity,
  getViewerId,
} from "../integrations/linear-agent-api.js";
import {
  createCliSpawner,
  type DispatchDeps,
  handleSession,
} from "../integrations/linear-agent-dispatch.js";
import { BaseCommand } from "../lib/base-command.js";
import { gitGetConfigValue } from "../lib/config.js";
import { MissingValueError } from "../lib/prompt.js";
import { redactSecrets } from "../lib/redact.js";

/**
 * #115 D2, D3, D6, D7: a foreground receiver for Linear `AgentSessionEvent`
 * webhooks, bound to 127.0.0.1, serving the repository it is started in.
 */

/** D6: the body cap. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Not 8787 (`docs/worker/wrangler.toml` pins it, so it collides on a
 * maintainer's own machine), not a common dev port (3000, 4000, 5173, 8000,
 * 8080, 9000), and below the OS ephemeral ranges (32768 on Linux, 49152 on
 * macOS) so an outgoing connection cannot be holding it. 8733 is "TREE" on a
 * phone keypad.
 */
const DEFAULT_PORT = 8733;

const DEFAULT_PATH = "/webhook";

/** A slow client holds a socket, not a thread, but it should not hold it for Node's 5 minutes. */
const HEADERS_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface ListenerOptions {
  /** `linear.webhookSecret`. */
  secret: string;
  /** The one path served. */
  path: string;
  /** Injected so freshness is testable; the real server passes `Date.now`. */
  now?: () => number;
  /** One line per call, already redacted. */
  log: (line: string) => void;
  dispatch: DispatchDeps;
}

export interface Listener {
  /** Not listening yet; the caller binds it. */
  server: Server;
  /** Stops accepting, waits for every child in flight, then drops the sockets. */
  shutdown(): Promise<void>;
}

type ReadResult = { body: Buffer } | { tooLarge: true };

/** Reads the raw bytes, stopping at the cap. A decoded string would change the bytes the signature covers. */
function readBody(request: IncomingMessage): Promise<ReadResult> {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      resolve({ tooLarge: true });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        request.removeAllListeners("data");
        request.resume();
        resolve({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve({ body: Buffer.concat(chunks) }));
    request.on("error", reject);
  });
}

/** The delivery header is not signed: only id characters reach a log line. */
function deliveryId(request: IncomingMessage): string {
  const header = request.headers["linear-delivery"];
  const value = typeof header === "string" ? header : "";
  // Redacted first: stripping the spaces would glue a token to the word before
  // it and hide it from the word-boundary patterns.
  return (
    redactSecrets(value)
      .replace(/[^A-Za-z0-9._-]/g, "")
      .slice(0, 64) || "-"
  );
}

function oneLine(text: string): string {
  return redactSecrets(text).replace(/\p{Cc}+/gu, " ");
}

function reply(
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { "Content-Length": "0", ...headers });
  response.end();
}

export function createListener(options: ListenerOptions): Listener {
  const now = options.now ?? Date.now;
  const inFlight = new Set<Promise<void>>();

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const delivery = deliveryId(request);
    const finish = (status: number, reason: string, headers = {}) => {
      reply(response, status, headers);
      options.log(oneLine(`delivery=${delivery} status=${status} ${reason}`));
    };

    if (request.method !== "POST") {
      finish(405, "method not allowed", { Allow: "POST" });
      return;
    }
    if ((request.url ?? "").split("?")[0] !== options.path) {
      finish(404, "unknown path");
      return;
    }

    const read = await readBody(request);
    if ("tooLarge" in read) {
      finish(413, "body over the 1 MiB cap", { Connection: "close" });
      return;
    }

    // D6: the signature is checked on the raw bytes, before anything parses them.
    const signature = request.headers["linear-signature"];
    if (
      !verifyWebhookSignature(
        read.body,
        typeof signature === "string" ? signature : undefined,
        options.secret,
      )
    ) {
      finish(401, "bad signature");
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(read.body.toString("utf8"));
    } catch {
      finish(400, "body is not JSON");
      return;
    }
    const event = parseAgentSessionEvent(json);
    if (event === null) {
      finish(400, "body is not an agent session event");
      return;
    }
    // The signed timestamp, not the unsigned Linear-Timestamp header, which a
    // replayed body could carry fresh (plan §4.3).
    if (!isTimestampFresh(event.webhookTimestamp, now())) {
      finish(401, "stale webhookTimestamp");
      return;
    }

    // D7: acknowledge first, work after.
    finish(200, `accepted ${event.action}`);
    const work = handleSession(event, {
      ...options.dispatch,
      log: (entry) =>
        options.log(
          oneLine(
            `delivery=${delivery} session=${entry.sessionId} ${entry.event}${entry.detail === undefined ? "" : ` ${entry.detail}`}`,
          ),
        ),
    }).catch(() => {
      // handleSession does not throw; this keeps a bug from becoming an
      // unhandled rejection. No error object is logged: its cause is unredacted.
      options.log(`delivery=${delivery} dispatch failed`);
    });
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) {
        reply(response, 500);
      }
    });
  });
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;

  return {
    server,
    async shutdown() {
      const closed = new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
      server.closeIdleConnections();
      await Promise.allSettled([...inFlight]);
      server.closeAllConnections();
      await closed;
    },
  };
}

/** The Linear user ids in `linear.agentAllow`: comma or whitespace separated. */
function parseAllowList(value: string): string[] {
  return value.split(/[\s,]+/).filter((id) => id !== "");
}

/** `viewer { id }` for the personal key (raw header, as linear.ts sends it). */
async function getKeyOwnerId(apiKey: string): Promise<string> {
  const response = await fetchLinear("query { viewer { id } }", {}, apiKey);
  const body: unknown = await response.json().catch(() => undefined);
  const data = (body as { data?: { viewer?: { id?: unknown } } } | undefined)
    ?.data;
  const id = data?.viewer?.id;
  if (!response.ok || typeof id !== "string" || id === "") {
    throw new Error("Linear: could not read the owner of linear.apiKey.");
  }
  return id;
}

export default class LinearListen extends BaseCommand {
  static override description =
    "Listen for Linear agent delegations and start a worktree for each";
  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --team ENG --port 9100",
  ];

  static override flags = {
    port: Flags.integer({
      description: `Port to listen on, on 127.0.0.1 only (0 lets the system pick)`,
      default: DEFAULT_PORT,
      min: 0,
      max: 65_535,
    }),
    path: Flags.string({
      description: "URL path that receives the webhook",
      default: DEFAULT_PATH,
    }),
    team: Flags.string({
      description: "Serve only sessions whose issue is in this Linear team key",
    }),
  };

  private async requireConfig() {
    const agentToken = await gitGetConfigValue("linear.agentToken");
    if (!agentToken) {
      throw new MissingValueError(
        "the Linear agent token",
        "`worktree config linear.agentToken <token>`",
      );
    }
    const webhookSecret = await gitGetConfigValue("linear.webhookSecret");
    if (!webhookSecret) {
      throw new MissingValueError(
        "the Linear webhook signing secret",
        "`worktree config linear.webhookSecret <secret>`",
      );
    }
    const apiKey = await gitGetConfigValue("linear.apiKey");
    if (!apiKey) {
      throw new MissingValueError(
        "the Linear API key",
        "`worktree config linear.apiKey <key>`",
      );
    }
    return { agentToken, webhookSecret, apiKey };
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(LinearListen);
    if (!flags.path.startsWith("/")) {
      this.error(`--path must start with "/", got "${flags.path}"`, {
        exit: 2,
      });
    }
    const teamKey = flags.team?.trim().toUpperCase() || undefined;

    const { agentToken, webhookSecret, apiKey } = await this.requireConfig();

    // Messages only: Phase 3's errors carry an unredacted `cause`.
    try {
      await getViewerId(agentToken);
    } catch (error) {
      this.error(
        redactSecrets(
          error instanceof Error ? error.message : "Linear rejected the token.",
        ),
        { exit: 1 },
      );
    }

    // D5: unset means only the person who owns the personal key.
    let allowedCreators = parseAllowList(
      await gitGetConfigValue("linear.agentAllow"),
    );
    if (allowedCreators.length === 0) {
      try {
        allowedCreators = [await getKeyOwnerId(apiKey)];
      } catch (error) {
        this.error(
          redactSecrets(
            error instanceof Error ? error.message : "Linear rejected the key.",
          ),
          { exit: 1 },
        );
      }
    }

    // D8: only an explicit "true" lets issue text reach an agent; the setter
    // refuses anything else, so a hand-edited oddity also reads as off.
    const includeIssueContext =
      (await gitGetConfigValue("linear.agentContext")) === "true";

    const listener = createListener({
      secret: webhookSecret,
      path: flags.path,
      log: (line) => this.logToStderr(line),
      dispatch: {
        token: agentToken,
        allowedCreators,
        teamKey,
        includeIssueContext,
        ledger: createSessionLedger(),
        createActivity: createAgentActivity,
        spawnChild: createCliSpawner(),
      },
    });

    await new Promise<void>((resolve, reject) => {
      listener.server.once("error", reject);
      listener.server.listen(flags.port, "127.0.0.1", resolve);
    }).catch((error: unknown) => {
      const code = (error as { code?: string }).code;
      this.error(
        code === "EADDRINUSE"
          ? `Port ${flags.port} is already in use. Pass another with --port.`
          : `Could not listen on 127.0.0.1:${flags.port}${code ? ` (${code})` : ""}.`,
        { exit: 1 },
      );
    });

    const address = listener.server.address();
    const port =
      typeof address === "object" && address ? address.port : flags.port;
    this.log(`Listening on http://127.0.0.1:${port}${flags.path}`);
    this.log(`Allowed creators: ${allowedCreators.join(", ")}`);
    this.log(teamKey ? `Team: ${teamKey}` : "Team: every team");
    this.log(
      includeIssueContext
        ? "Issue context: on (the issue's text goes to the agent, fenced as untrusted)"
        : "Issue context: off (the agent is told the issue identifier only)",
    );
    this.log(
      "Expose this address over HTTPS (a tunnel or reverse proxy) and set it as the app's webhook URL. SIGTERM stops it after the running session finishes (a terminal Ctrl-C also interrupts the running worktree command).",
    );

    await this.untilSignal(listener);
  }

  /** A first SIGINT/SIGTERM drains; a second one stops waiting. */
  private untilSignal(listener: Listener): Promise<void> {
    return new Promise<void>((resolve) => {
      let draining = false;
      const onSignal = () => {
        if (draining) {
          this.logToStderr("Second signal: exiting without waiting.");
          process.exit(130);
        }
        draining = true;
        this.logToStderr("Stopping: waiting for the running session...");
        void listener.shutdown().then(() => {
          process.off("SIGINT", onSignal);
          process.off("SIGTERM", onSignal);
          resolve();
        });
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
    });
  }
}
