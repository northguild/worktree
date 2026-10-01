import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: ["./src/test-setup.ts"],
    disableConsoleIntercept: true, // Required for @oclif/test
    // chalk styles output when it detects colour support, so console assertions
    // would pass in CI (no TTY) and fail in an interactive shell. Pin it off.
    env: { FORCE_COLOR: "0" },
  },
});
