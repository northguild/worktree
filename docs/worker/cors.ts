// Allowed origins for CORS.
// Production: the docs site host (all routes share this origin).
// Development: Astro dev server, default port 4321.
const CORS_ORIGINS = ["https://northguild.dev", "http://localhost:4321"];

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin !== null && CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // Without this a browser hides Retry-After from the page's JavaScript.
    "Access-Control-Expose-Headers": "Retry-After",
    Vary: "Origin",
  };
}
