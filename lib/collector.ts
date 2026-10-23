import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import {
  saveMetricSample,
  saveProcessSamples,
  type ProcessMetric,
} from "./database";

const SAMPLE_INTERVAL_MS = 3_000;
const execFileAsync = promisify(execFile);
const collectorGlobal = globalThis as typeof globalThis & {
  pcStatusCollectorStarted?: boolean;
};

type RawProcess = {
  pid: number;
  name: string;
  startedAt: string;
  cpuTime100ns: number;
  memoryUsedBytes: number;
};

type PreviousProcessSample = {
  cpuTime100ns: number;
};

const powershellProcessSnapshot = `
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance -ClassName Win32_Process | ForEach-Object {
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    name = [string]$_.Name
    startedAt = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }
    cpuTime100ns = [double]($_.KernelModeTime + $_.UserModeTime)
    memoryUsedBytes = [long]$_.WorkingSetSize
  }
})
ConvertTo-Json -InputObject $processes -Compress
`;

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

/** Retrieves raw process CPU counters and working-set sizes through Windows CIM. */
async function getRawProcesses(): Promise<RawProcess[]> {
  if (process.platform !== "win32") {
    throw new Error("Per-process metrics collection requires Windows.");
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", powershellProcessSnapshot],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  const result: unknown = JSON.parse(stdout);
  const processes = Array.isArray(result) ? result : [result];
  if (
    !processes.every(
      (item): item is RawProcess => {
        if (typeof item !== "object" || item === null) {
          return false;
        }
        const process = item as Record<string, unknown>;
        return (
          typeof process.pid === "number" &&
          typeof process.name === "string" &&
          typeof process.startedAt === "string" &&
          typeof process.cpuTime100ns === "number" &&
          typeof process.memoryUsedBytes === "number"
        );
      },
    )
  ) {
    throw new Error("Windows returned an invalid process metrics snapshot.");
  }
  return processes;
}

/** Starts the recurring system metrics collector once per server process. */
export function startMetricsCollector(): void {
  if (collectorGlobal.pcStatusCollectorStarted) {
    return;
  }
  collectorGlobal.pcStatusCollectorStarted = true;

  let previousCpuTimes = getCpuTimes();
  let previousProcessSamples = new Map<string, PreviousProcessSample>();
  let previousProcessSampleAt = Date.now();

  /** Measures current CPU and memory usage and saves a sample. */
  const sample = async () => {
    const startedAt = Date.now();
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

      const sampledAt = Date.now();
      const rawProcesses = await getRawProcesses();
      const elapsedMs = sampledAt - previousProcessSampleAt;
      const coreCount = Math.max(os.cpus().length, 1);
      const currentProcessSamples = new Map<string, PreviousProcessSample>();
      const processMetrics: ProcessMetric[] = rawProcesses
        .filter((process) => process.pid !== 0)
        .map((process) => {
          const processKey = `${process.pid}:${process.startedAt}`;
          const previous = previousProcessSamples.get(processKey);
          const cpuUsage =
            previous && elapsedMs > 0
              ? ((process.cpuTime100ns - previous.cpuTime100ns) /
                  (elapsedMs * 10_000 * coreCount)) *
                100
              : 0;
          currentProcessSamples.set(processKey, {
            cpuTime100ns: process.cpuTime100ns,
          });
          return {
            pid: process.pid,
            name: process.name,
            startedAt: process.startedAt,
            cpuUsage: Number(Math.max(cpuUsage, 0).toFixed(2)),
            memoryUsedBytes: process.memoryUsedBytes,
            memoryUsage:
              memoryTotalBytes > 0
                ? Number(
                    (
                      (process.memoryUsedBytes / memoryTotalBytes) *
                      100
                    ).toFixed(2),
                  )
                : 0,
          };
        });
      previousProcessSamples = currentProcessSamples;
      previousProcessSampleAt = sampledAt;
      saveProcessSamples(sampledAt, processMetrics);
    } catch (error) {
      console.error("Failed to collect or save system/process metrics:", error);
    } finally {
      const nextDelay = Math.max(
        0,
        SAMPLE_INTERVAL_MS - (Date.now() - startedAt),
      );
      setTimeout(sample, nextDelay);
    }
  };

  setTimeout(sample, SAMPLE_INTERVAL_MS);
}
