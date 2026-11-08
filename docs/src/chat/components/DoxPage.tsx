/**
 * The full-bleed `/dox` surface (plan #309 D6; ported from gmt's `DoxPage`). It is deliberately not a nav bar: the
 * site header shows on this route as on every page and gives the way back, so the strip holds chat status only,
 * here the environment badge. The body holds the empty hub: the crystal at logo scale and the prompt line. The
 * transcript, the composer and the rail arrive in later phases.
 */
import { useEffect, useState } from "react";
import "../../styles/dox-hive.css";
import { ChatErrorBoundary } from "./ChatErrorBoundary";
import { HiveHub } from "./hive/HiveHub";

/**
 * Which Worker this page is talking to. Read after mount, never during render: deriving it from `window.location`
 * made the server render one value and the client another, which React reports as a hydration mismatch. `null` is the
 * pre-mount state and renders nothing, so the badge cannot flicker from the wrong label to the right one.
 */
type Environment = "local" | "live";

function useEnvironment(): Environment | null {
  const [environment, setEnvironment] = useState<Environment | null>(null);
  useEffect(() => {
    const { hostname } = window.location;
    setEnvironment(
      hostname === "localhost" || hostname === "127.0.0.1" ? "local" : "live",
    );
  }, []);
  return environment;
}

export function DoxPage() {
  const environment = useEnvironment();

  // `not-content` is Starlight's opt-out from its markdown rules: the island sits inside `.sl-markdown-content`, whose
  // `code` rules (colour, fill, size, margin, padding) would otherwise win over the hive's own at equal specificity.
  return (
    <div className="gmt-hive-shell not-content">
      <div className="gmt-hive-strip">
        <div className="gmt-hive-strip-end">
          {/* Standing status rather than a control, so it keeps the corner. */}
          {environment && (
            <span
              className="gmt-hive-env"
              data-env={environment}
              title={
                environment === "local"
                  ? "Pointed at a Worker on this machine"
                  : "Pointed at the deployed Worker"
              }
            >
              ● {environment}
            </span>
          )}
        </div>
      </div>
      <div className="gmt-hive-body" data-empty>
        <ChatErrorBoundary>
          <div className="gmt-hive-chat">
            <div className="gmt-hive">
              <div className="gmt-hive-empty">
                <HiveHub />
                {/* Names the character: the code treatment ties "Dox" to the crystal above it and to the package
                    name, so both read as identifiers and not as prose. */}
                <p className="gmt-hive-prompt">
                  Ask <code className="gmt-hive-name">Dox</code> about
                  worktrees, branches and issues in{" "}
                  <code>@northguild/worktree</code>.
                </p>
              </div>
            </div>
          </div>
        </ChatErrorBoundary>
      </div>
    </div>
  );
}
