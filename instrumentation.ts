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

    if (process.env.NODE_ENV === "production" && String(process.env.FOREMENTION_OUTREACH_SECRET || "").trim()) {
      void import("@/lib/hunter/foremention-client")
        .then(({ probeForementionMiniAuditAuth }) => probeForementionMiniAuditAuth())
        .then((result) => {
          if (result.ok) {
            console.info(`[hunter] mini-audit signed auth probe ok (HTTP ${result.status})`);
          } else {
            console.warn(`[hunter] mini-audit signed auth probe failed reason=${result.reason} status=${result.status ?? "none"}`);
          }
        })
        .catch((err) => {
          console.warn("[hunter] mini-audit signed auth probe failed unexpectedly:", err instanceof Error ? err.message : "unknown error");
        });
    }
  }
}
