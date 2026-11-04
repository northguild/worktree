/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Public URL of the Cloudflare Worker; unset in dev, where the chat falls back to localhost:8787. */
  readonly PUBLIC_GEMINI_WORKER_URL?: string;
}
