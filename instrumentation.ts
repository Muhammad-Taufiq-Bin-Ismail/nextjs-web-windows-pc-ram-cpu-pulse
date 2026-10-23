/** Starts the background metrics collector when the Node.js server initializes. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMetricsCollector } = await import("./lib/collector");
    startMetricsCollector();
  }
}
