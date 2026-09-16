export async function register() {
  // Only run on the Node.js server runtime, not in the browser/edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { ensureGlobalRunnerStarted } = await import("@/lib/linkedin/runner");
      ensureGlobalRunnerStarted();
    } catch (err) {
      console.error("[instrumentation] Failed to start Linki runner:", err);
    }

    try {
      const { ensureHunterRunnerStarted } = await import("@/lib/hunter/runner");
      ensureHunterRunnerStarted();
    } catch (err) {
      console.error("[instrumentation] Failed to start Customer Hunter runner:", err);
    }
  }
}
