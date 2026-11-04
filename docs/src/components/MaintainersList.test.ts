// @vitest-environment node
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import MaintainersList from "./MaintainersList.astro";

// Node environment: Astro refuses to render a component under jsdom, so the markup is read as a string.
// Expected values come from the old Footer/ProfileAvatarLink tests (git show a01aa77^:docs/src/components/):
// links open in a new tab with rel="noopener noreferrer"; the avatar's alt is the name; the name shows only on request.
async function render(props: Record<string, unknown>) {
  const container = await AstroContainer.create();
  return container.renderToString(MaintainersList, { props });
}

const craig = {
  name: "Craig O. Curtis",
  profileUrl: "https://github.com/craig-o-curtis",
  avatarUrl: "https://github.com/craig-o-curtis.png?size=64",
};

describe("MaintainersList", () => {
  it("links each profile in a new tab without leaking the opener", async () => {
    const html = await render({ maintainers: [craig], label: "Maintainers" });
    expect(html).toMatch(/<a href="https:\/\/github\.com\/craig-o-curtis"/);
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it("shows the name beside the avatar, which is then decorative", async () => {
    const html = await render({ maintainers: [craig], label: "Maintainers" });
    expect(html).toMatch(/<span[^>]*>Craig O\. Curtis<\/span>/);
    expect(html).toMatch(/<img[^>]* alt(?:=""|\s|>)/);
    expect(html).not.toMatch(/alt="Craig/);
  });

  it("names the link by the avatar's alt text when the name is hidden", async () => {
    const html = await render({
      maintainers: [craig],
      showName: false,
      label: "Owner",
    });
    expect(html).toMatch(
      /<img src="https:\/\/github\.com\/craig-o-curtis\.png\?size=64" alt="Craig O\. Curtis"/,
    );
    expect(html).not.toMatch(/<span/);
  });

  it("renders one list item per maintainer, labelled", async () => {
    const html = await render({
      maintainers: [craig, { ...craig, name: "Other" }],
      label: "Maintainers",
    });
    expect(html).toMatch(/<ul[^>]* aria-label="Maintainers"/);
    expect(html.match(/<li/g)).toHaveLength(2);
  });
});
