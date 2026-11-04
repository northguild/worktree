/**
 * /worktree/llms.txt (D13): generated at build from the docs content collection. The text is `renderLlmsTxt`'s.
 */

import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { renderLlmsTxt } from "../lib/llms-txt";

export const GET: APIRoute = async () => {
  const entries = await getCollection("docs");
  const body = renderLlmsTxt(
    entries.map(({ id, data }) => ({
      id,
      title: data.title,
      description: data.description ?? "",
    })),
  );
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
