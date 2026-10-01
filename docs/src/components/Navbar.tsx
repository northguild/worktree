import Image from "next/image";
import Link from "next/link";
import { Navbar as NextraNavbar } from "nextra-theme-docs";
import {
  projectLink,
  projectName,
  projectOwnerAvatarUrl,
} from "../lib/site-meta";

// Nextra's own logo link is disabled (`logoLink={false}`) because its fixed
// aria-label "Home page" does not contain the visible text "Worktree" (WCAG
// 2.5.3). The logo is instead a next/link to "/", which applies the production
// basePath. The avatar is decorative (alt=""); the link's name starts with the
// visible text and says where it goes. The utility classes are the ones
// Nextra's logo link uses, for the keyboard focus ring and hover affordance.
export function Navbar() {
  return (
    <NextraNavbar
      logoLink={false}
      logo={
        <Link
          href="/"
          aria-label={`${projectName} home page`}
          className="x:transition-opacity x:focus-visible:nextra-focus x:hover:opacity-75"
          style={{
            alignItems: "center",
            display: "inline-flex",
            fontWeight: 700,
            gap: "0.5rem",
          }}
        >
          <Image
            src={projectOwnerAvatarUrl}
            alt=""
            width={32}
            height={32}
            style={{ borderRadius: "999px" }}
          />
          {projectName}
        </Link>
      }
      projectLink={projectLink}
    />
  );
}
