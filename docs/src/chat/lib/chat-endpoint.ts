const LOCAL_WORKER_URL = "http://localhost:8787";

/**
 * The chat route on the Worker (plan #257 D11): `PUBLIC_GEMINI_WORKER_URL`
 * joined to `/api/chat` with exactly one slash, or the local Worker's address
 * when it is unset or empty.
 */
export function chatEndpoint(workerUrl: string | undefined): string {
  const base = workerUrl || LOCAL_WORKER_URL;
  return `${base.replace(/\/+$/, "")}/api/chat`;
}
