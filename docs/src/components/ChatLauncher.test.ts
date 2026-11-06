// @vitest-environment node

import { readFileSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import ChatLauncher from "./ChatLauncher.astro";

// Node environment: Astro refuses to render a component under jsdom, so the markup is read as a string.
// Expected values: D6 (a static button, no framework JS) and the scope line (an accessible name that is
// correct before the chat loads). The behaviour behind the button is tested in chat/components/ChatLauncher.test.tsx.
describe("ChatLauncher markup", () => {
  async function render() {
    const container = await AstroContainer.create();
    return container.renderToString(ChatLauncher);
  }

  it("is a plain button named 'Open chat' with a decorative icon", async () => {
    const html = await render();
    expect(html).toMatch(
      /<button[^>]*type="button"[^>]*aria-label="Open chat"|<button[^>]*aria-label="Open chat"[^>]*type="button"/,
    );
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("has an alert region for a failed load, empty to begin with", async () => {
    const html = await render();
    expect(html).toMatch(
      /<div[^>]*role="alert"[^>]*data-chat-launcher-status[^>]*><\/div>/,
    );
  });

  it("ships no React: the page script only imports the launcher module", async () => {
    const html = await render();
    expect(html).not.toMatch(/client:|astro-island|react/i);
  });
});

// Expected value: #266 D11 (the user's report of 2026-11-06: the chat button cannot be clicked on inner pages). The
// launcher renders inside Starlight's `.main-pane`, which is `isolation: isolate`, so the right sidebar paints over it
// whatever its z-index; moving the root to the end of <body> takes it out of that stacking context. It has to happen before
// `initChatLauncher` runs, so the handlers and the loaded chat attach to the element where it stays.
describe("ChatLauncher placement", () => {
  const source = readFileSync(
    new URL("./ChatLauncher.astro", import.meta.url),
    "utf8",
  );
  const script = source.slice(
    source.indexOf("<script>"),
    source.indexOf("</script>"),
  );

  it("moves its root to the end of <body> before the launcher starts", () => {
    const move = script.search(/document\.body\.append(Child)?\(root\)/);
    const init = script.indexOf("initChatLauncher(root");
    expect(move).toBeGreaterThan(-1);
    expect(init).toBeGreaterThan(move);
  });
});
