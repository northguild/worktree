import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { Navbar } from "./Navbar";

type MockNavbarProps = {
  logo: ReactNode;
  projectLink: string;
};

vi.mock("next/image", () => ({
  default: ({ alt }: { alt?: string }) => (
    <span data-testid="avatar" data-alt={alt} />
  ),
}));

// next/link is what applies the production basePath; tag it so a plain
// <a href="/"> cannot satisfy the assertions below.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} data-next-link="true" {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("nextra-theme-docs", () => ({
  Navbar: ({ logo, projectLink }: MockNavbarProps) => (
    <div>
      <div>{logo}</div>
      <a href={projectLink}>Project Link</a>
    </div>
  ),
}));

describe("Navbar", () => {
  it("renders the repository link", () => {
    render(<Navbar />);

    expect(screen.getByRole("link", { name: "Project Link" })).toHaveAttribute(
      "href",
      "https://github.com/northguild/worktree",
    );
  });

  it("links the logo to the site root through next/link, named for its destination", () => {
    render(<Navbar />);

    const home = screen.getByRole("link", { name: "Worktree home page" });
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveAttribute("data-next-link", "true");
    expect(home).toHaveTextContent("Worktree");
  });

  it("does not nest a link inside the logo and treats the avatar as decorative", () => {
    render(<Navbar />);

    const home = screen.getByRole("link", { name: "Worktree home page" });
    expect(home.querySelectorAll("a")).toHaveLength(0);
    expect(screen.getByTestId("avatar")).toHaveAttribute("data-alt", "");
  });
});
