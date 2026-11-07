import { detectTerminalHosts } from "./terminal-host.js";

// Variable names are the ones a real Herdr pane and a real Rex terminal set
// (#271 §1, observed in the author's shell). The expected value in each row is
// decided by the rule in #271 D2/D3/D4, not by running the detector.
const herdr = {
  HERDR_ENV: "1",
  HERDR_PANE_ID: "p_1",
  HERDR_WORKSPACE_ID: "w_1",
  HERDR_TAB_ID: "w_1:1",
  HERDR_SOCKET_PATH: "/tmp/herdr.sock",
  HERDR_BIN_PATH: "/usr/local/bin/herdr",
};

const rex = {
  REX_SESSION: "session:6f1c2a3e-8d4b-4c5a-9e7f-0a1b2c3d4e5f",
  REX_BLOCK: "block:1",
  REX_BIN_DIR: "/Applications/Rex.app/Contents/Helpers",
  REX_SERVER: "/tmp/rex.sock",
};

describe("detectTerminalHosts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each`
    description                                  | env                                              | expected
    ${"Herdr only"}                              | ${herdr}                                         | ${["herdr"]}
    ${"Rex only"}                                | ${rex}                                           | ${["rex"]}
    ${"both: Herdr then Rex (D3 tie-break)"}     | ${{ ...rex, ...herdr }}                          | ${["herdr", "rex"]}
    ${"an editor host alone (D4)"}               | ${{ TERM_PROGRAM: "vscode", VSCODE_PID: "123" }} | ${[]}
    ${"a plain terminal"}                        | ${{ PATH: "/usr/bin", TERM: "xterm-256color" }}  | ${[]}
    ${"an empty HERDR_ENV"}                      | ${{ ...herdr, HERDR_ENV: "" }}                   | ${[]}
    ${"HERDR_ENV without HERDR_PANE_ID"}         | ${{ HERDR_ENV: "1" }}                            | ${[]}
    ${"an empty HERDR_PANE_ID"}                  | ${{ ...herdr, HERDR_PANE_ID: "" }}               | ${[]}
    ${"REX_SESSION without the session: prefix"} | ${{ ...rex, REX_SESSION: "6f1c2a3e" }}           | ${[]}
    ${"an editor inside Herdr: Herdr wins"}      | ${{ ...herdr, TERM_PROGRAM: "vscode" }}          | ${["herdr"]}
  `("$description -> $expected", ({ env, expected }) => {
    expect(detectTerminalHosts(env)).toEqual(expected);
  });

  it("reads process.env when no environment is passed", () => {
    vi.stubEnv("HERDR_ENV", "1");
    vi.stubEnv("HERDR_PANE_ID", "p_1");
    vi.stubEnv("REX_SESSION", "");
    expect(detectTerminalHosts()).toEqual(["herdr"]);
  });
});
