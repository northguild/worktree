const LOCAL_WORKER_URL = "http://localhost:8787";

/** `PUBLIC_GEMINI_WORKER_URL` joined to `path` with exactly one slash, or the local Worker's address when it is unset or empty. */
function workerRoute(workerUrl: string | undefined, path: string): string {
  const base = workerUrl || LOCAL_WORKER_URL;
  return `${base.replace(/\/+$/, "")}${path}`;
}

/**
 * The chat route on the Worker (plan #257 D11): `PUBLIC_GEMINI_WORKER_URL`
 * joined to `/api/chat` with exactly one slash, or the local Worker's address
 * when it is unset or empty.
 */
export function chatEndpoint(workerUrl: string | undefined): string {
  return workerRoute(workerUrl, "/api/chat");
}

/** The usage route on the same Worker (plan #309 D10): what the brain badge reads, joined the same way. */
export function brainsEndpoint(workerUrl: string | undefined): string {
  return workerRoute(workerUrl, "/api/brains");
}
