import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import {
  saveMetricSample,
  saveProcessSamples,
  type ProcessMetric,
} from "./database";
import { cpuSpeedThresholdGhz } from "./config";

const SAMPLE_INTERVAL_MS = 3_000;
const PROCESS_SAMPLE_RETENTION_MS = 60 * 60 * 1_000;
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

type RawProcessSnapshot = {
  cpuSpeedGhz: number;
  processes: RawProcess[];
};

type PreviousProcessSample = {
  cpuTime100ns: number;
};

const powershellProcessSnapshot = `
$ErrorActionPreference = 'Stop'
$MaxSpeed = [double]((Get-CimInstance Win32_Processor | Measure-Object -Property MaxClockSpeed -Average).Average)
$PerfPercentage = $null
try {
  $PerfPercentage = (Get-Counter -Counter "\\Processor Information(_Total)\\% Processor Performance" -ErrorAction Stop).CounterSamples[0].CookedValue
} catch {
  $PerfPercentage = $null
}
if (-not $PerfPercentage) {
  try {
    $PerfPercentage = (Get-Counter -Counter "\\Processor(_Total)\\% of Maximum Frequency" -ErrorAction Stop).CounterSamples[0].CookedValue
  } catch {
    $PerfPercentage = $null
  }
}
if (-not $MaxSpeed -or -not $PerfPercentage) {
  throw 'Unable to read the current processor clock speed.'
}
$CurrentSpeedGHz = [Math]::Round(($MaxSpeed * ($PerfPercentage / 100)) / 1000, 2)
$processes = @(Get-CimInstance -ClassName Win32_Process | ForEach-Object {
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    name = [string]$_.Name
    startedAt = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }
    cpuTime100ns = [double]($_.KernelModeTime + $_.UserModeTime)
    memoryUsedBytes = [long]$_.WorkingSetSize
  }
})
[pscustomobject]@{
  cpuSpeedGhz = $CurrentSpeedGHz
  processes = $processes
} | ConvertTo-Json -Depth 4 -Compress
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
async function getRawProcesses(): Promise<RawProcessSnapshot> {
  if (process.platform !== "win32") {
    throw new Error("Per-process metrics collection requires Windows.");
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", powershellProcessSnapshot],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  const result: unknown = JSON.parse(stdout);
  if (typeof result !== "object" || result === null) {
    throw new Error("Windows returned an invalid process metrics snapshot.");
  }
  const snapshot = result as Record<string, unknown>;
  const rawProcesses = snapshot.processes;
  const processes = Array.isArray(rawProcesses) ? rawProcesses : [rawProcesses];
  if (
    typeof snapshot.cpuSpeedGhz !== "number" ||
    !Number.isFinite(snapshot.cpuSpeedGhz) ||
    snapshot.cpuSpeedGhz <= 0
  ) {
    throw new Error("Windows returned an invalid CPU speed reading.");
  }
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
  return {
    cpuSpeedGhz: snapshot.cpuSpeedGhz,
    processes,
  };
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

      const sampledAt = Date.now();
      const rawSnapshot = await getRawProcesses();
      saveMetricSample({
        sampledAt,
        cpuUsage: Number(cpuUsage.toFixed(2)),
        cpuSpeedMhz: rawSnapshot.cpuSpeedGhz * 1_000,
        memoryUsage: Number(memoryUsage.toFixed(2)),
        memoryUsedBytes,
        memoryTotalBytes,
      }, cpuSpeedThresholdGhz);

      const elapsedMs = sampledAt - previousProcessSampleAt;
      const coreCount = Math.max(os.cpus().length, 1);
      const currentProcessSamples = new Map<string, PreviousProcessSample>();
      const processMetrics: ProcessMetric[] = rawSnapshot.processes
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
      saveProcessSamples(sampledAt, processMetrics, PROCESS_SAMPLE_RETENTION_MS);
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
