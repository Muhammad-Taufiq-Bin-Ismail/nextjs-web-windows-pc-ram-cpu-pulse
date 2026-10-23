import os from "node:os";
import { saveMetricSample } from "./database";

const SAMPLE_INTERVAL_MS = 3_000;
const collectorGlobal = globalThis as typeof globalThis & {
  pcStatusCollectorStarted?: boolean;
};

/** Totals CPU time counters across all processor cores. */
function getCpuTimes() {
  return os.cpus().reduce(
    (totals, cpu) => {
      const times = cpu.times;
      totals.total +=
        times.user + times.nice + times.sys + times.idle + times.irq;
      totals.idle += times.idle;
      return totals;
    },
    { total: 0, idle: 0 },
  );
}

/** Starts the recurring system metrics collector once per server process. */
export function startMetricsCollector(): void {
  if (collectorGlobal.pcStatusCollectorStarted) {
    return;
  }
  collectorGlobal.pcStatusCollectorStarted = true;

  let previousCpuTimes = getCpuTimes();

  /** Measures current CPU and memory usage and saves a sample. */
  const sample = () => {
    try {
      const currentCpuTimes = getCpuTimes();
      const totalDelta = currentCpuTimes.total - previousCpuTimes.total;
      const idleDelta = currentCpuTimes.idle - previousCpuTimes.idle;
      previousCpuTimes = currentCpuTimes;

      const memoryTotalBytes = os.totalmem();
      const memoryUsedBytes = memoryTotalBytes - os.freemem();
      const cpuUsage =
        totalDelta > 0
          ? ((totalDelta - idleDelta) / totalDelta) * 100
          : 0;
      const memoryUsage =
        memoryTotalBytes > 0
          ? (memoryUsedBytes / memoryTotalBytes) * 100
          : 0;

      saveMetricSample({
        sampledAt: Date.now(),
        cpuUsage: Number(cpuUsage.toFixed(2)),
        memoryUsage: Number(memoryUsage.toFixed(2)),
        memoryUsedBytes,
        memoryTotalBytes,
      });
    } catch (error) {
      console.error("Failed to collect or save PC metrics:", error);
    } finally {
      setTimeout(sample, SAMPLE_INTERVAL_MS);
    }
  };

  setTimeout(sample, SAMPLE_INTERVAL_MS);
}
