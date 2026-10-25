"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { MetricChart } from "./components/MetricChart";
import { ProcessSparkline } from "./components/ProcessSparkline";
import { QuickRangeControls } from "./components/QuickRangeControls";

type MetricSample = {
  sampledAt: number;
  cpuUsage: number;
  cpuSpeedMhz: number;
  memoryUsage: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
};

type CpuSpeedAlert = {
  id: number;
  triggeredAt: number;
  cpuSpeedMhz: number;
  thresholdGhz: number;
};

/** Estimates per-process CPU speed using overall speed times CPU usage fraction. */
function estimateProcessCpuSpeedGhz(sample: ProcessHistoryPoint): number | null {
  if (sample.cpuUsage <= 0 || sample.cpuSpeedMhz <= 0) {
    return null;
  }
  return (sample.cpuSpeedMhz / 1_000) * (sample.cpuUsage / 100);
}

type ProcessMetric = {
  pid: number;
  name: string;
  startedAt: string;
  cpuUsage: number;
  memoryUsedBytes: number;
  memoryUsage: number;
};

type ProcessHistory = {
  pid: number;
  startedAt: string;
  samples: Array<{
    sampledAt: number;
    cpuUsage: number;
    memoryUsage: number;
  }>;
};

type ProcessSnapshotResult = {
  sampledAt: number | null;
  processes: ProcessMetric[];
};

type ProcessHistoryPoint = ProcessMetric & {
  sampledAt: number;
  cpuSpeedMhz: number;
};

type MetricsResponse = {
  samples: MetricSample[];
  processes: ProcessMetric[];
  processHistory: ProcessHistory[];
  cpuSpeedThresholdGhz: number;
  cpuSpeedAlerts: CpuSpeedAlert[];
  lastUpdated: number | null;
};

type ProcessorInfo = {
  name: string;
  coreCount: number;
  logicalProcessorCount: number;
};

type ProcessSortColumn = "name" | "pid" | "cpuUsage" | "memoryUsedBytes" | "memoryUsage";
type SortDirection = "ascending" | "descending";
type Theme = "light" | "dark";

/** Formats a byte count as gibibytes for the dashboard. */
function formatBytes(bytes: number): string {
  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes.toFixed(1)} GB`;
}

/** Formats per-process memory in megabytes for the process table. */
function formatProcessMemory(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** Formats a date using the browser's local timezone for a date input. */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Formats a time using the browser's local timezone for a time input. */
function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/** Groups a process's observations by task name and records its first and last seen times. */
function getProcessNameObservations(samples: ProcessHistoryPoint[]) {
  const observations = new Map<
    string,
    { name: string; firstSeen: number; lastSeen: number }
  >();
  for (const sample of samples) {
    const observation = observations.get(sample.name);
    if (observation) {
      observation.firstSeen = Math.min(observation.firstSeen, sample.sampledAt);
      observation.lastSeen = Math.max(observation.lastSeen, sample.sampledAt);
    } else {
      observations.set(sample.name, {
        name: sample.name,
        firstSeen: sample.sampledAt,
        lastSeen: sample.sampledAt,
      });
    }
  }
  return Array.from(observations.values()).sort(
    (left, right) => left.firstSeen - right.firstSeen,
  );
}

/** Renders the live CPU and memory monitoring dashboard. */
export default function DashboardPage() {
  const [data, setData] = useState<MetricsResponse>({
    samples: [],
    processes: [],
    processHistory: [],
    cpuSpeedThresholdGhz: 2.15,
    cpuSpeedAlerts: [],
    lastUpdated: null,
  });
  const [theme, setTheme] = useState<Theme>("light");
  const [error, setError] = useState<string | null>(null);
  const [processorInfo, setProcessorInfo] = useState<ProcessorInfo | null>(null);
  const [processorInfoError, setProcessorInfoError] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<CpuSpeedAlert | null>(null);
  const [alertProcessSnapshot, setAlertProcessSnapshot] =
    useState<ProcessSnapshotResult | null>(null);
  const [alertSnapshotLoading, setAlertSnapshotLoading] = useState(false);
  const [alertSnapshotError, setAlertSnapshotError] = useState<string | null>(
    null,
  );
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [notificationError, setNotificationError] = useState<string | null>(
    null,
  );
  const alertBaselineLoaded = useRef(false);
  const lastHandledAlertId = useRef(0);
  const [rangeStartDate, setRangeStartDate] = useState("");
  const [rangeStartTime, setRangeStartTime] = useState("");
  const [rangeEndDate, setRangeEndDate] = useState("");
  const [rangeEndTime, setRangeEndTime] = useState("");
  const [rangeSamples, setRangeSamples] = useState<MetricSample[]>([]);
  const [liveHoveredSampledAt, setLiveHoveredSampledAt] = useState<
    number | null
  >(null);
  const [rangeHoveredSampledAt, setRangeHoveredSampledAt] = useState<
    number | null
  >(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [selectedChartSample, setSelectedChartSample] =
    useState<MetricSample | null>(null);
  const [selectedProcessSnapshot, setSelectedProcessSnapshot] =
    useState<ProcessSnapshotResult | null>(null);
  const [processSnapshotLoading, setProcessSnapshotLoading] = useState(false);
  const [processSnapshotError, setProcessSnapshotError] = useState<string | null>(
    null,
  );
  const processSnapshotRequestId = useRef(0);
  const alertSnapshotRequestId = useRef(0);
  const [historyProcess, setHistoryProcess] = useState<ProcessMetric | null>(
    null,
  );
  const [processHistoryStartDate, setProcessHistoryStartDate] = useState("");
  const [processHistoryStartTime, setProcessHistoryStartTime] = useState("");
  const [processHistoryEndDate, setProcessHistoryEndDate] = useState("");
  const [processHistoryEndTime, setProcessHistoryEndTime] = useState("");
  const [processHistory, setProcessHistory] = useState<ProcessHistoryPoint[]>([]);
  const [processHistoryLoading, setProcessHistoryLoading] = useState(false);
  const [processHistoryError, setProcessHistoryError] = useState<string | null>(
    null,
  );
  const processHistoryRequestId = useRef(0);
  const [sortColumn, setSortColumn] = useState<ProcessSortColumn>("cpuUsage");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("descending");
  const [snapshotSortColumn, setSnapshotSortColumn] =
    useState<ProcessSortColumn>("cpuUsage");
  const [snapshotSortDirection, setSnapshotSortDirection] =
    useState<SortDirection>("descending");

  useEffect(() => {
    if ("Notification" in window) {
      setNotificationPermission(window.Notification.permission);
    } else {
      setNotificationPermission("unsupported");
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadProcessorInfo = async () => {
      try {
        const response = await fetch("/api/system-info", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Processor information request failed (${response.status})`);
        }
        const result = (await response.json()) as ProcessorInfo;
        if (active) {
          setProcessorInfo(result);
          setProcessorInfoError(null);
        }
      } catch (cause) {
        console.error("Unable to load processor information:", cause);
        if (active) {
          setProcessorInfoError("Unable to load processor information.");
        }
      }
    };

    void loadProcessorInfo();
    return () => {
      active = false;
    };
  }, []);

  /** Requests browser permission from the user's explicit button action. */
  const enableBrowserNotifications = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    try {
      setNotificationPermission(await window.Notification.requestPermission());
      setNotificationError(null);
    } catch (cause) {
      console.error("Unable to request browser notification permission:", cause);
      setNotificationError("Unable to enable browser notifications.");
    }
  };

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem("pc-status-theme");
      if (savedTheme === "dark" || savedTheme === "light") {
        setTheme(savedTheme);
        document.documentElement.dataset.theme = savedTheme;
      }
    } catch (cause) {
      console.error("Unable to load the saved dashboard theme:", cause);
    }
  }, []);

  /** Switches the dashboard palette and remembers the selection. */
  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem("pc-status-theme", nextTheme);
    } catch (cause) {
      console.error("Unable to save the dashboard theme:", cause);
    }
  };

  useEffect(() => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1_000);
    setRangeStartDate(formatLocalDate(oneHourAgo));
    setRangeStartTime(formatLocalTime(oneHourAgo));
    setRangeEndDate(formatLocalDate(now));
    setRangeEndTime(formatLocalTime(now));
  }, []);

  // Fetch metrics immediately, then refresh every five seconds until unmounted.
  useEffect(() => {
    let active = true;

    /** Loads the latest metrics and updates the dashboard or its error state. */
    const refresh = async () => {
      try {
        const response = await fetch("/api/metrics", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Metrics request failed (${response.status})`);
        }
        const result = (await response.json()) as MetricsResponse;
        if (active) {
          const latestAlertId = result.cpuSpeedAlerts.reduce(
            (latestId, alert) => Math.max(latestId, alert.id),
            0,
          );
          if (alertBaselineLoaded.current) {
            const newAlerts = result.cpuSpeedAlerts
              .filter((alert) => alert.id > lastHandledAlertId.current)
              .sort((left, right) => left.id - right.id);
            if (
              window.Notification?.permission === "granted" &&
              newAlerts.length > 0
            ) {
              for (const alert of newAlerts) {
                try {
                  new window.Notification("CPU speed threshold exceeded", {
                    body: `${(alert.cpuSpeedMhz / 1_000).toFixed(2)} GHz exceeded ${alert.thresholdGhz.toFixed(2)} GHz at ${new Date(alert.triggeredAt).toLocaleString()}.`,
                  });
                } catch (cause) {
                  console.error("Unable to display CPU speed notification:", cause);
                  break;
                }
              }
            }
          } else {
            alertBaselineLoaded.current = true;
          }
          lastHandledAlertId.current = Math.max(
            lastHandledAlertId.current,
            latestAlertId,
          );
          setData(result);
          setError(null);
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load metrics",
          );
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    // Prevent pending updates and stop polling after the dashboard unmounts.
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const latestSample = data.samples.at(-1);
  /** Converts samples into the chart's timestamp-and-value format. */
  const chartSamples = (key: "cpuUsage" | "memoryUsage" | "cpuSpeedMhz") =>
    data.samples.map((sample) => ({
      sampledAt: sample.sampledAt,
      value:
        key === "cpuSpeedMhz"
          ? sample.cpuSpeedMhz / 1_000
          : sample[key],
      cpuUsage: sample.cpuUsage,
      memoryUsage: sample.memoryUsage,
      cpuSpeedMhz: sample.cpuSpeedMhz,
    }));
  const processHistoryByKey = new Map(
    data.processHistory.map((history) => [
      `${history.pid}-${history.startedAt}`,
      history,
    ]),
  );
  const sortedProcesses = [...data.processes].sort((left, right) => {
    let comparison: number;
    if (sortColumn === "name") {
      comparison = left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    } else if (sortColumn === "pid") {
      comparison = left.pid - right.pid;
    } else if (sortColumn === "cpuUsage") {
      comparison = left.cpuUsage - right.cpuUsage;
    } else if (sortColumn === "memoryUsedBytes") {
      comparison = left.memoryUsedBytes - right.memoryUsedBytes;
    } else {
      comparison = left.memoryUsage - right.memoryUsage;
    }
    return sortDirection === "ascending" ? comparison : -comparison;
  });

  /** Sorts the selected process column, toggling direction on repeated clicks. */
  const changeProcessSort = (column: ProcessSortColumn) => {
    if (sortColumn === column) {
      setSortDirection((direction) =>
        direction === "ascending" ? "descending" : "ascending",
      );
      return;
    }
    setSortColumn(column);
    setSortDirection("ascending");
  };

  /** Sorts columns in the process snapshot selected from a historical chart. */
  const changeSnapshotSort = (column: ProcessSortColumn) => {
    if (snapshotSortColumn === column) {
      setSnapshotSortDirection((direction) =>
        direction === "ascending" ? "descending" : "ascending",
      );
      return;
    }
    setSnapshotSortColumn(column);
    setSnapshotSortDirection("ascending");
  };

  const sortedSnapshotProcesses = [
    ...(selectedProcessSnapshot?.processes ?? []),
  ].sort((left, right) => {
    let comparison: number;
    if (snapshotSortColumn === "name") {
      comparison = left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    } else if (snapshotSortColumn === "pid") {
      comparison = left.pid - right.pid;
    } else if (snapshotSortColumn === "cpuUsage") {
      comparison = left.cpuUsage - right.cpuUsage;
    } else if (snapshotSortColumn === "memoryUsedBytes") {
      comparison = left.memoryUsedBytes - right.memoryUsedBytes;
    } else {
      comparison = left.memoryUsage - right.memoryUsage;
    }
    return snapshotSortDirection === "ascending" ? comparison : -comparison;
  });

  /** Loads samples for the selected timestamp range and updates the date/time controls. */
  const applyRange = async (startTime: number, endTime: number) => {
    if (
      !Number.isSafeInteger(startTime) ||
      !Number.isSafeInteger(endTime) ||
      startTime < 0 ||
      endTime < startTime
    ) {
      setRangeError("Choose a valid start and end date and time.");
      return;
    }

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    setRangeStartDate(formatLocalDate(startDate));
    setRangeStartTime(formatLocalTime(startDate));
    setRangeEndDate(formatLocalDate(endDate));
    setRangeEndTime(formatLocalTime(endDate));
    setRangeError(null);
    setSelectedChartSample(null);
    setSelectedProcessSnapshot(null);
    setRangeLoading(true);
    try {
      const query = new URLSearchParams({
        start: String(startTime),
        end: String(endTime),
      });
      const response = await fetch(`/api/metrics/history?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`History request failed (${response.status})`);
      }
      const result = (await response.json()) as {
        samples: MetricSample[];
      };
      setRangeSamples(result.samples);
    } catch (cause) {
      setRangeError(
        cause instanceof Error ? cause.message : "Unable to load chart history",
      );
    } finally {
      setRangeLoading(false);
    }
  };

  /** Loads overall system samples for the selected local date and time range. */
  const loadRangeSamples = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRangeError(null);

    const startTime = new Date(
      `${rangeStartDate}T${rangeStartTime}`,
    ).getTime();
    const endTime = new Date(`${rangeEndDate}T${rangeEndTime}`).getTime();
    if (
      !rangeStartDate ||
      !rangeStartTime ||
      !rangeEndDate ||
      !rangeEndTime ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      endTime < startTime
    ) {
      setRangeError("Choose a valid start and end date and time.");
      return;
    }

    await applyRange(startTime, endTime);
  };

  /** Loads the process snapshot nearest to a clicked overall chart sample. */
  const loadProcessSnapshot = async (sample: MetricSample) => {
    const requestId = ++processSnapshotRequestId.current;
    setSelectedChartSample(sample);
    setSelectedProcessSnapshot(null);
    setProcessSnapshotError(null);
    setProcessSnapshotLoading(true);

    try {
      const response = await fetch(
        `/api/metrics/processes?at=${sample.sampledAt}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`Process snapshot request failed (${response.status})`);
      }
      const result = (await response.json()) as ProcessSnapshotResult;
      if (requestId === processSnapshotRequestId.current) {
        setSelectedProcessSnapshot(result);
      }
    } catch (cause) {
      if (requestId === processSnapshotRequestId.current) {
        setProcessSnapshotError(
          cause instanceof Error
            ? cause.message
            : "Unable to load process snapshot",
        );
      }
    } finally {
      if (requestId === processSnapshotRequestId.current) {
        setProcessSnapshotLoading(false);
      }
    }
  };

  /** Loads the process snapshot nearest to a CPU speed alert. */
  const openAlertProcessSnapshot = async (alert: CpuSpeedAlert) => {
    const requestId = ++alertSnapshotRequestId.current;
    setSelectedAlert(alert);
    setAlertProcessSnapshot(null);
    setAlertSnapshotError(null);
    setAlertSnapshotLoading(true);

    try {
      const response = await fetch(
        `/api/metrics/processes?at=${alert.triggeredAt}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`Process snapshot request failed (${response.status})`);
      }
      const result = (await response.json()) as ProcessSnapshotResult;
      if (requestId === alertSnapshotRequestId.current) {
        setAlertProcessSnapshot(result);
      }
    } catch (cause) {
      if (requestId === alertSnapshotRequestId.current) {
        setAlertSnapshotError(
          cause instanceof Error
            ? cause.message
            : "Unable to load process snapshot.",
        );
      }
    } finally {
      if (requestId === alertSnapshotRequestId.current) {
        setAlertSnapshotLoading(false);
      }
    }
  };

  /** Closes the alert snapshot dialog and ignores any pending request. */
  const closeAlertProcessSnapshot = () => {
    alertSnapshotRequestId.current += 1;
    setSelectedAlert(null);
    setAlertSnapshotLoading(false);
  };

  /** Loads one process instance's retained history for the selected time range. */
  const fetchProcessHistory = async (
    process: ProcessMetric,
    startTime: number,
    endTime: number,
  ) => {
    const requestId = ++processHistoryRequestId.current;
    setProcessHistoryLoading(true);
    setProcessHistoryError(null);
    try {
      const query = new URLSearchParams({
        pid: String(process.pid),
        startedAt: process.startedAt,
        start: String(startTime),
        end: String(endTime),
      });
      const response = await fetch(`/api/metrics/process-history?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Process history request failed (${response.status})`);
      }
      const result = (await response.json()) as {
        samples: ProcessHistoryPoint[];
      };
      if (requestId === processHistoryRequestId.current) {
        setProcessHistory(result.samples);
      }
    } catch (cause) {
      if (requestId === processHistoryRequestId.current) {
        setProcessHistoryError(
          cause instanceof Error
            ? cause.message
            : "Unable to load process history",
        );
      }
    } finally {
      if (requestId === processHistoryRequestId.current) {
        setProcessHistoryLoading(false);
      }
    }
  };

  /** Opens process history with the latest hour selected. */
  const openProcessHistory = (process: ProcessMetric) => {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 60 * 60 * 1_000);
    setHistoryProcess(process);
    setProcessHistory([]);
    setProcessHistoryStartDate(formatLocalDate(startDate));
    setProcessHistoryStartTime(formatLocalTime(startDate));
    setProcessHistoryEndDate(formatLocalDate(endDate));
    setProcessHistoryEndTime(formatLocalTime(endDate));
    void fetchProcessHistory(
      process,
      startDate.getTime(),
      endDate.getTime(),
    );
  };

  /** Applies the popover's date and time filters to process history. */
  const loadSelectedProcessHistory = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!historyProcess) return;
    const startTime = new Date(
      `${processHistoryStartDate}T${processHistoryStartTime}`,
    ).getTime();
    const endTime = new Date(
      `${processHistoryEndDate}T${processHistoryEndTime}`,
    ).getTime();
    if (
      !processHistoryStartDate ||
      !processHistoryStartTime ||
      !processHistoryEndDate ||
      !processHistoryEndTime ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      endTime < startTime
    ) {
      setProcessHistoryError("Choose a valid start and end date and time.");
      return;
    }
    await fetchProcessHistory(historyProcess, startTime, endTime);
  };

  /** Applies a quick process-history duration and synchronizes its date controls. */
  const applyProcessQuickRange = (durationMs: number) => {
    if (!historyProcess) return;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - durationMs);
    setProcessHistoryStartDate(formatLocalDate(startDate));
    setProcessHistoryStartTime(formatLocalTime(startDate));
    setProcessHistoryEndDate(formatLocalDate(endDate));
    setProcessHistoryEndTime(formatLocalTime(endDate));
    void fetchProcessHistory(
      historyProcess,
      startDate.getTime(),
      endDate.getTime(),
    );
  };

  /** Closes the process history popover and ignores any pending request. */
  const closeProcessHistory = () => {
    processHistoryRequestId.current += 1;
    setHistoryProcess(null);
    setProcessHistoryLoading(false);
  };

  return (
    <main className="dashboard">
      <header className="topbar">
        <a aria-label="PC Status home" className="brand" href="/">
          <span className="brand-mark">P</span>
          <span>Pulse<span className="brand-light">/PC</span></span>
        </a>
        <div className="live-status">
          <span className="live-dot" />
          <span>LIVE MONITORING V1</span>
        </div>
        <button
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          aria-pressed={theme === "dark"}
          className="theme-toggle"
          onClick={toggleTheme}
          type="button"
        >
          <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
          <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
        </button>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">SYSTEM OVERVIEW</p>
          <h1>PC Performance</h1>
          <p className="subtitle">
            Real-time resource monitoring for this machine.
          </p>
        </div>
        <div className="refresh-label">
          <span className="refresh-icon">↻</span>
          Refreshes every 5 seconds
        </div>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <span>Retrying automatically</span>
        </div>
      )}

      <section aria-label="Current system metrics" className="stat-grid">
        <article className="stat-card">
          <div className="stat-card-heading">
            <span className="stat-icon cpu-icon">CPU</span>
            <span className="stat-label">Processor</span>
            <span className="stat-indicator" />
          </div>
          <div className="stat-value">
            {latestSample ? latestSample.cpuUsage.toFixed(1) : "--"}
            <span>%</span>
          </div>
          <div className="stat-foot">
            <span>Total processor utilization</span>
            <span>All cores</span>
          </div>
          <div className="stat-meter">
            <span
              className="cpu-meter"
              style={{ width: `${latestSample?.cpuUsage ?? 0}%` }}
            />
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-card-heading">
            <span className="stat-icon memory-icon">RAM</span>
            <span className="stat-label">Memory</span>
            <span className="stat-indicator memory-indicator" />
          </div>
          <div className="stat-value">
            {latestSample ? latestSample.memoryUsage.toFixed(1) : "--"}
            <span>%</span>
          </div>
          <div className="stat-foot">
            <span>
              {latestSample
                ? `${formatBytes(latestSample.memoryUsedBytes)} of ${formatBytes(latestSample.memoryTotalBytes)}`
                : "Used memory"}
            </span>
            <span>System</span>
          </div>
          <div className="stat-meter">
            <span
              className="memory-meter"
              style={{ width: `${latestSample?.memoryUsage ?? 0}%` }}
            />
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-card-heading">
            <span className="stat-icon speed-icon">GHz</span>
            <span className="stat-label">CPU speed</span>
            <span className="stat-indicator speed-indicator" />
          </div>
          {processorInfo ? (
            <>
              <span>{processorInfo.name}</span>
              <br />
              <span>
                {processorInfo.coreCount} Cores,{" "}
                {processorInfo.logicalProcessorCount} Logical Processors
              </span>
            </>
          ) : (
            <span>{processorInfoError ?? "Loading processor information..."}</span>
          )}
          <div className="stat-value">
            {latestSample
              ? (latestSample.cpuSpeedMhz / 1_000).toFixed(2)
              : "--"}
            <span>GHz</span>
          </div>
          <div className="stat-foot">
            <span>Real-time processor clock</span>
            <span>All cores</span>
          </div>
        </article>
      </section>

      <section
        aria-label="CPU speed threshold notifications"
        className="alert-history-card"
      >
        <div className="alert-heading">
          <div>
            <p className="eyebrow">CPU SPEED ALERTS</p>
            <h2>Threshold: {data.cpuSpeedThresholdGhz.toFixed(2)} GHz</h2>
          </div>
          <button
            className="notification-button"
            disabled={
              notificationPermission === "granted" ||
              notificationPermission === "denied" ||
              notificationPermission === "unsupported"
            }
            onClick={() => void enableBrowserNotifications()}
            type="button"
          >
            {notificationPermission === "granted"
              ? "Desktop notifications enabled"
              : notificationPermission === "denied"
                ? "Notifications blocked in browser"
                : notificationPermission === "unsupported"
                  ? "Desktop notifications unavailable"
                  : "Enable desktop notifications"}
          </button>
        </div>
        <p className="alert-description">
          Threshold is configured on the server with{" "}
          <code>CPU_SPEED_THRESHOLD_GHZ</code>; the default is 2.15 GHz.
        </p>
        {notificationPermission === "denied" && (
          <p className="alert-history-empty">
            Browser notifications are blocked. Allow them for this site in your
            browser settings to enable desktop alerts.
          </p>
        )}
        {notificationError && (
          <p className="range-error" role="alert">
            {notificationError}
          </p>
        )}
        {latestSample &&
          latestSample.cpuSpeedMhz / 1_000 > data.cpuSpeedThresholdGhz && (
            <p aria-live="assertive" className="cpu-speed-alert" role="alert">
              CPU speed is above threshold:{" "}
              {(latestSample.cpuSpeedMhz / 1_000).toFixed(2)} GHz at{" "}
              {new Date(latestSample.sampledAt).toLocaleString()}.
            </p>
          )}
        <h3 className="alert-history-title">Exceedance history</h3>
        {data.cpuSpeedAlerts.length === 0 ? (
          <p className="alert-history-empty">No threshold exceedances yet.</p>
        ) : (
          <div className="alert-history-list" role="table" aria-label="CPU speed exceedance history">
            <div className="alert-history-row alert-history-header" role="row">
              <span role="columnheader">Triggered at</span>
              <span role="columnheader">CPU speed</span>
              <span role="columnheader">Threshold</span>
            </div>
            {data.cpuSpeedAlerts.map((alert) => (
              <div
                aria-haspopup="dialog"
                aria-label={`Show process snapshot for alert at ${new Date(alert.triggeredAt).toLocaleString()}`}
                className="alert-history-row alert-history-entry"
                key={alert.id}
                onClick={() => void openAlertProcessSnapshot(alert)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openAlertProcessSnapshot(alert);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span role="cell">
                  {new Date(alert.triggeredAt).toLocaleString()}
                </span>
                <span role="cell">
                  {(alert.cpuSpeedMhz / 1_000).toFixed(2)} GHz
                </span>
                <span role="cell">{alert.thresholdGhz.toFixed(2)} GHz</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedAlert && (
        <div
          className="process-popover-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeAlertProcessSnapshot();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeAlertProcessSnapshot();
          }}
          role="presentation"
        >
          <section
            aria-labelledby="alert-process-snapshot-title"
            aria-modal="true"
            className="process-popover"
            role="dialog"
          >
            <div className="process-popover-heading">
              <div>
                <p className="eyebrow">PROCESS SNAPSHOT</p>
                <h2 id="alert-process-snapshot-title">
                  Processes at{" "}
                  {new Date(selectedAlert.triggeredAt).toLocaleString()}
                </h2>
                {alertProcessSnapshot?.sampledAt !== null &&
                  alertProcessSnapshot?.sampledAt !== undefined && (
                    <p className="process-description">
                      Snapshot captured{" "}
                      {new Date(
                        alertProcessSnapshot.sampledAt,
                      ).toLocaleTimeString()}
                    </p>
                  )}
              </div>
              <button
                aria-label="Close alert process snapshot"
                className="popover-close"
                onClick={closeAlertProcessSnapshot}
                type="button"
              >
                ×
              </button>
            </div>
            {alertSnapshotLoading && (
              <p aria-live="polite" className="snapshot-message">
                Loading process usage...
              </p>
            )}
            {alertSnapshotError && (
              <p className="range-error" role="alert">
                {alertSnapshotError}
              </p>
            )}
            {!alertSnapshotLoading &&
              !alertSnapshotError &&
              alertProcessSnapshot?.sampledAt === null && (
                <p className="snapshot-message">
                  No process snapshot is available within 5 seconds of this
                  alert. Process snapshots are retained for one hour.
                </p>
              )}
            {!alertSnapshotLoading &&
              !alertSnapshotError &&
              alertProcessSnapshot?.sampledAt !== null &&
              alertProcessSnapshot && (
                <div className="process-table-wrap">
                  <table className="process-table snapshot-process-table">
                    <thead>
                      <tr>
                        <th scope="col">Task name</th>
                        <th scope="col">PID</th>
                        <th scope="col">CPU</th>
                        <th scope="col">RAM</th>
                        <th scope="col">RAM %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alertProcessSnapshot.processes.map((process) => (
                        <tr
                          key={`${process.pid}-${process.startedAt}`}
                          title={`Started ${process.startedAt || "unknown"}`}
                        >
                          <td className="process-name">{process.name}</td>
                          <td className="process-pid">
                            <button
                              className="process-pid-button"
                              onClick={() => openProcessHistory(process)}
                              type="button"
                            >
                              {process.pid}
                            </button>
                          </td>
                          <td className="process-cpu">
                            {process.cpuUsage.toFixed(1)}%
                          </td>
                          <td>{formatProcessMemory(process.memoryUsedBytes)}</td>
                          <td>{process.memoryUsage.toFixed(2)}%</td>
                        </tr>
                      ))}
                      {alertProcessSnapshot.processes.length === 0 && (
                        <tr>
                          <td className="process-empty" colSpan={5}>
                            No process metrics were recorded in this snapshot.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        </div>
      )}

      <section aria-label="Usage history" className="charts-grid metric-charts-grid">
        <article className="chart-card">
          <div className="chart-heading">
            <div>
              <p className="eyebrow">PROCESSOR</p>
              <h2>CPU usage</h2>
            </div>
            <span className="chart-current cpu-text">
              {latestSample ? `${latestSample.cpuUsage.toFixed(1)}%` : "--"}
            </span>
          </div>
          <MetricChart
            color="#7c6cf2"
            label="CPU"
            linkedSampledAt={liveHoveredSampledAt}
            onHoverSample={setLiveHoveredSampledAt}
            samples={chartSamples("cpuUsage")}
          />
          <div className="chart-legend">
            <span className="legend-dot cpu-dot" />
            Utilization
            <span className="chart-period">Last 6 minutes</span>
          </div>
        </article>

        <article className="chart-card">
          <div className="chart-heading">
            <div>
              <p className="eyebrow">MEMORY</p>
              <h2>RAM usage</h2>
            </div>
            <span className="chart-current memory-text">
              {latestSample ? `${latestSample.memoryUsage.toFixed(1)}%` : "--"}
            </span>
          </div>
          <MetricChart
            color="#18b89a"
            label="RAM"
            linkedSampledAt={liveHoveredSampledAt}
            onHoverSample={setLiveHoveredSampledAt}
            samples={chartSamples("memoryUsage")}
          />
          <div className="chart-legend">
            <span className="legend-dot memory-dot" />
            Memory used
            <span className="chart-period">Last 6 minutes</span>
          </div>
        </article>
        <article className="chart-card">
          <div className="chart-heading">
            <div>
              <p className="eyebrow">PROCESSOR</p>
              <h2>CPU speed</h2>
            </div>
            <span className="chart-current cpu-text">
              {latestSample
                ? `${(latestSample.cpuSpeedMhz / 1_000).toFixed(2)} GHz`
                : "--"}
            </span>
          </div>
          <MetricChart
            color="#e59d38"
            label="CPU speed"
            linkedSampledAt={liveHoveredSampledAt}
            onHoverSample={setLiveHoveredSampledAt}
            samples={chartSamples("cpuSpeedMhz")}
            valueUnit="ghz"
          />
          <div className="chart-legend">
            <span className="legend-dot speed-dot" />
            Clock speed
            <span className="chart-period">Last 6 minutes</span>
          </div>
        </article>
      </section>

      <section aria-label="Custom CPU and RAM history" className="range-card">
        <div className="range-heading">
          <div>
            <p className="eyebrow">HISTORICAL OVERVIEW</p>
            <h2>Explore a time range</h2>
          </div>
        </div>
        <p className="range-description">
          Choose a quick range or local start and end dates and times to view
          overall system CPU, CPU speed, and RAM usage. Drag across a chart to
          zoom into a time range, or click a point to see its process snapshot.
        </p>
        <QuickRangeControls
          onApply={(durationMs) => {
            const endTime = Date.now();
            void applyRange(endTime - durationMs, endTime);
          }}
        />
        <form className="range-form" onSubmit={loadRangeSamples}>
          <fieldset className="range-fieldset">
            <legend>Start</legend>
            <label>
              <span>Date</span>
              <input
                aria-label="Start date"
                onChange={(event) => setRangeStartDate(event.target.value)}
                required
                type="date"
                value={rangeStartDate}
              />
            </label>
            <label>
              <span>Time</span>
              <input
                aria-label="Start time"
                onChange={(event) => setRangeStartTime(event.target.value)}
                required
                step={1}
                type="time"
                value={rangeStartTime}
              />
            </label>
          </fieldset>
          <fieldset className="range-fieldset">
            <legend>End</legend>
            <label>
              <span>Date</span>
              <input
                aria-label="End date"
                onChange={(event) => setRangeEndDate(event.target.value)}
                required
                type="date"
                value={rangeEndDate}
              />
            </label>
            <label>
              <span>Time</span>
              <input
                aria-label="End time"
                onChange={(event) => setRangeEndTime(event.target.value)}
                required
                step={1}
                type="time"
                value={rangeEndTime}
              />
            </label>
          </fieldset>
          <button className="range-submit" disabled={rangeLoading} type="submit">
            {rangeLoading ? "Loading..." : "Show chart"}
          </button>
        </form>
        {rangeError && (
          <p className="range-error" role="alert">
            {rangeError}
          </p>
        )}
        <p aria-live="polite" className="range-result-label">
          {rangeSamples.length
            ? `${rangeSamples.length.toLocaleString()} samples in selected range`
            : "No samples loaded for the selected range"}
        </p>
        <div className="charts-grid metric-charts-grid range-charts">
          <article className="chart-card">
            <div className="chart-heading">
              <div>
                <p className="eyebrow">OVERALL SYSTEM</p>
                <h2>CPU usage</h2>
              </div>
            </div>
            <MetricChart
              color="#7c6cf2"
              label="CPU"
              linkedSampledAt={rangeHoveredSampledAt}
              onHoverSample={setRangeHoveredSampledAt}
              onSampleClick={(point) => {
                const sample = rangeSamples.find(
                  (item) => item.sampledAt === point.sampledAt,
                );
                if (sample) void loadProcessSnapshot(sample);
              }}
              onSelectRange={(range) => {
                void applyRange(range.start, range.end);
              }}
              samples={rangeSamples.map((sample) => ({
                sampledAt: sample.sampledAt,
                value: sample.cpuUsage,
                cpuUsage: sample.cpuUsage,
                memoryUsage: sample.memoryUsage,
                cpuSpeedMhz: sample.cpuSpeedMhz,
              }))}
            />
          </article>
          <article className="chart-card">
            <div className="chart-heading">
              <div>
                <p className="eyebrow">OVERALL SYSTEM</p>
                <h2>RAM usage</h2>
              </div>
            </div>
            <MetricChart
              color="#18b89a"
              label="RAM"
              linkedSampledAt={rangeHoveredSampledAt}
              onHoverSample={setRangeHoveredSampledAt}
              onSampleClick={(point) => {
                const sample = rangeSamples.find(
                  (item) => item.sampledAt === point.sampledAt,
                );
                if (sample) void loadProcessSnapshot(sample);
              }}
              onSelectRange={(range) => {
                void applyRange(range.start, range.end);
              }}
              samples={rangeSamples.map((sample) => ({
                sampledAt: sample.sampledAt,
                value: sample.memoryUsage,
                cpuUsage: sample.cpuUsage,
                memoryUsage: sample.memoryUsage,
                cpuSpeedMhz: sample.cpuSpeedMhz,
              }))}
            />
          </article>
          <article className="chart-card">
            <div className="chart-heading">
              <div>
                <p className="eyebrow">OVERALL SYSTEM</p>
                <h2>CPU speed</h2>
              </div>
            </div>
            <MetricChart
              color="#e59d38"
              label="CPU speed"
              linkedSampledAt={rangeHoveredSampledAt}
              onHoverSample={setRangeHoveredSampledAt}
              onSelectRange={(range) => {
                void applyRange(range.start, range.end);
              }}
              samples={rangeSamples.map((sample) => ({
                sampledAt: sample.sampledAt,
                value: sample.cpuSpeedMhz / 1_000,
                cpuUsage: sample.cpuUsage,
                memoryUsage: sample.memoryUsage,
                cpuSpeedMhz: sample.cpuSpeedMhz,
              }))}
              valueUnit="ghz"
            />
          </article>
        </div>
        {selectedChartSample && (
          <section
            aria-label="Processes at selected chart time"
            className="selected-process-card"
          >
            <div className="process-heading">
              <div>
                <p className="eyebrow">PROCESS SNAPSHOT</p>
                <h2>
                  Processes at{" "}
                  {new Date(selectedChartSample.sampledAt).toLocaleString()}
                </h2>
              </div>
              {selectedProcessSnapshot?.sampledAt && (
                <span className="process-count">
                  Snapshot{" "}
                  {new Date(
                    selectedProcessSnapshot.sampledAt,
                  ).toLocaleTimeString()}
                </span>
              )}
            </div>
            <p className="process-description">
              Showing the closest stored process snapshot within 5 seconds of
              the selected chart point.
            </p>
            {processSnapshotLoading && (
              <p aria-live="polite" className="snapshot-message">
                Loading process usage...
              </p>
            )}
            {processSnapshotError && (
              <p className="range-error" role="alert">
                {processSnapshotError}
              </p>
            )}
            {!processSnapshotLoading &&
              !processSnapshotError &&
              selectedProcessSnapshot?.sampledAt === null && (
                <p className="snapshot-message">
                  No process snapshot is available near this time. Process
                  snapshots are retained for one hour.
                </p>
              )}
            {!processSnapshotLoading &&
              selectedProcessSnapshot &&
              selectedProcessSnapshot.sampledAt !== null && (
                <div className="process-table-wrap">
                  <table className="process-table snapshot-process-table">
                    <thead>
                      <tr>
                        {(
                          [
                            ["name", "Task name"],
                            ["pid", "PID"],
                            ["cpuUsage", "CPU"],
                            ["memoryUsedBytes", "RAM"],
                            ["memoryUsage", "RAM %"],
                          ] as const
                        ).map(([column, label]) => (
                          <th
                            key={column}
                            aria-sort={
                              snapshotSortColumn === column
                                ? snapshotSortDirection
                                : "none"
                            }
                            scope="col"
                          >
                            <button
                              className="process-sort-button"
                              onClick={() => changeSnapshotSort(column)}
                              type="button"
                            >
                              {label}
                              {snapshotSortColumn === column && (
                                <span aria-hidden="true">
                                  {snapshotSortDirection === "ascending"
                                    ? " ↑"
                                    : " ↓"}
                                </span>
                              )}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSnapshotProcesses.map((process) => (
                        <tr
                          key={`${process.pid}-${process.startedAt}`}
                          title={`Started ${process.startedAt || "unknown"}`}
                        >
                          <td className="process-name">{process.name}</td>
                          <td className="process-pid">
                            <button
                              className="process-pid-button"
                              onClick={() => openProcessHistory(process)}
                              type="button"
                            >
                              {process.pid}
                            </button>
                          </td>
                          <td className="process-cpu">
                            {process.cpuUsage.toFixed(1)}%
                          </td>
                          <td>{formatProcessMemory(process.memoryUsedBytes)}</td>
                          <td>{process.memoryUsage.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        )}
      </section>

      <section aria-label="Per-process CPU and RAM usage" className="process-card">
        <div className="process-heading">
          <div>
            <p className="eyebrow">RUNNING TASKS</p>
            <h2>Process usage</h2>
          </div>
          <span className="process-count">
            {data.processes.length} processes
          </span>
        </div>
        <p className="process-description">
          CPU is normalized across all logical cores. RAM shows each process&apos;s
          working set and share of system memory. Trend charts use up to 120
          samples per process.
        </p>
        <div className="process-table-wrap">
          <table className="process-table">
            <thead>
              <tr>
                <th
                  aria-sort={
                    sortColumn === "name" ? sortDirection : "none"
                  }
                  scope="col"
                >
                  <button
                    className="process-sort-button"
                    onClick={() => changeProcessSort("name")}
                    type="button"
                  >
                    Task name
                    {sortColumn === "name" && (
                      <span aria-hidden="true">
                        {sortDirection === "ascending" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </button>
                </th>
                <th
                  aria-sort={sortColumn === "pid" ? sortDirection : "none"}
                  scope="col"
                >
                  <button
                    className="process-sort-button"
                    onClick={() => changeProcessSort("pid")}
                    type="button"
                  >
                    PID
                    {sortColumn === "pid" && (
                      <span aria-hidden="true">
                        {sortDirection === "ascending" ? " ↑" : " ↓"}
                      </span>
                    )}
                  </button>
                </th>
                {(
                  [
                    ["cpuUsage", "CPU"],
                    ["memoryUsedBytes", "RAM"],
                    ["memoryUsage", "RAM %"],
                  ] as const
                ).map(([column, label]) => (
                  <th
                    key={column}
                    aria-sort={
                      sortColumn === column ? sortDirection : "none"
                    }
                    scope="col"
                  >
                    <button
                      className="process-sort-button"
                      onClick={() => changeProcessSort(column)}
                      type="button"
                    >
                      {label}
                      {sortColumn === column && (
                        <span aria-hidden="true">
                          {sortDirection === "ascending" ? " ↑" : " ↓"}
                        </span>
                      )}
                    </button>
                  </th>
                ))}
                <th scope="col">CPU trend</th>
                <th scope="col">RAM trend</th>
              </tr>
            </thead>
            <tbody>
              {sortedProcesses.map((process) => {
                const history = processHistoryByKey.get(
                  `${process.pid}-${process.startedAt}`,
                );
                return (
                  <tr
                    key={`${process.pid}-${process.startedAt}`}
                    title={`Started ${process.startedAt || "unknown"}`}
                  >
                    <td className="process-name">{process.name}</td>
                    <td className="process-pid">
                      <button
                        className="process-pid-button"
                        onClick={() => openProcessHistory(process)}
                        type="button"
                      >
                        {process.pid}
                      </button>
                    </td>
                    <td className="process-cpu">
                      {process.cpuUsage.toFixed(1)}%
                    </td>
                    <td>{formatProcessMemory(process.memoryUsedBytes)}</td>
                    <td>{process.memoryUsage.toFixed(2)}%</td>
                    <td>
                      <ProcessSparkline
                        color="#7c6cf2"
                        label={`${process.name} PID ${process.pid} CPU`}
                        values={
                          history?.samples.map((sample) => sample.cpuUsage) ??
                          []
                        }
                      />
                    </td>
                    <td>
                      <ProcessSparkline
                        color="#18b89a"
                        label={`${process.name} PID ${process.pid} RAM`}
                        values={
                          history?.samples.map((sample) => sample.memoryUsage) ??
                          []
                        }
                      />
                    </td>
                  </tr>
                );
              })}
              {data.processes.length === 0 && (
                <tr>
                  <td className="process-empty" colSpan={7}>
                    Waiting for the first process snapshot...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {historyProcess && (
        <div
          className="process-popover-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeProcessHistory();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeProcessHistory();
          }}
          role="presentation"
        >
          <section
            aria-labelledby="process-history-title"
            aria-modal="true"
            className="process-popover"
            role="dialog"
          >
            <div className="process-popover-heading">
              <div>
                <p className="eyebrow">PROCESS HISTORY</p>
                <h2 id="process-history-title">
                  {historyProcess.name} <span>PID {historyProcess.pid}</span>
                </h2>
                <p className="process-description">
                  Process instance started{" "}
                  {historyProcess.startedAt
                    ? new Date(historyProcess.startedAt).toLocaleString()
                    : "at an unknown time"}
                </p>
              </div>
              <button
                aria-label="Close process history"
                className="popover-close"
                onClick={closeProcessHistory}
                type="button"
              >
                ×
              </button>
            </div>
            <form
              className="range-form process-history-form"
              onSubmit={loadSelectedProcessHistory}
            >
              <QuickRangeControls
                maxMinutes={60}
                onApply={applyProcessQuickRange}
              />
              <fieldset className="range-fieldset">
                <legend>Start</legend>
                <label>
                  <span>Date</span>
                  <input
                    aria-label="Process history start date"
                    onChange={(event) =>
                      setProcessHistoryStartDate(event.target.value)
                    }
                    required
                    type="date"
                    value={processHistoryStartDate}
                  />
                </label>
                <label>
                  <span>Time</span>
                  <input
                    aria-label="Process history start time"
                    onChange={(event) =>
                      setProcessHistoryStartTime(event.target.value)
                    }
                    required
                    step={1}
                    type="time"
                    value={processHistoryStartTime}
                  />
                </label>
              </fieldset>
              <fieldset className="range-fieldset">
                <legend>End</legend>
                <label>
                  <span>Date</span>
                  <input
                    aria-label="Process history end date"
                    onChange={(event) =>
                      setProcessHistoryEndDate(event.target.value)
                    }
                    required
                    type="date"
                    value={processHistoryEndDate}
                  />
                </label>
                <label>
                  <span>Time</span>
                  <input
                    aria-label="Process history end time"
                    onChange={(event) =>
                      setProcessHistoryEndTime(event.target.value)
                    }
                    required
                    step={1}
                    type="time"
                    value={processHistoryEndTime}
                  />
                </label>
              </fieldset>
              <button
                className="range-submit"
                disabled={processHistoryLoading}
                type="submit"
              >
                {processHistoryLoading ? "Loading..." : "Apply range"}
              </button>
            </form>
            <p className="process-description history-retention-note">
              Process history is retained for one hour. Minute ranges are
              configurable up to 60 minutes.
            </p>
            {processHistoryError && (
              <p className="range-error" role="alert">
                {processHistoryError}
              </p>
            )}
            {processHistoryLoading ? (
              <p aria-live="polite" className="snapshot-message">
                Loading process history...
              </p>
            ) : processHistory.length === 0 ? (
              <p className="snapshot-message">
                No samples for this process in the selected range.
              </p>
            ) : (
              <>
                <p className="process-description">
                  Estimated CPU speed = overall CPU speed × process CPU usage
                  fraction; unavailable when process CPU usage is zero.
                </p>
                <div className="process-table-wrap name-history-wrap">
                  <table className="process-table name-history-table">
                    <thead>
                      <tr>
                        <th scope="col">Task name</th>
                        <th scope="col">First date/time noticed</th>
                        <th scope="col">Last date/time noticed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getProcessNameObservations(processHistory).map(
                        (observation) => (
                          <tr key={observation.name}>
                            <td className="process-name">{observation.name}</td>
                            <td>
                              {new Date(observation.firstSeen).toLocaleString()}
                            </td>
                            <td>
                              {new Date(observation.lastSeen).toLocaleString()}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="process-history-charts">
                  <article className="chart-card">
                    <div className="chart-heading">
                      <div>
                        <p className="eyebrow">PROCESS CPU</p>
                        <h2>CPU usage</h2>
                      </div>
                    </div>
                    <MetricChart
                      color="#7c6cf2"
                      label="CPU"
                      samples={processHistory.map((sample) => ({
                        sampledAt: sample.sampledAt,
                        value: sample.cpuUsage,
                        cpuUsage: sample.cpuUsage,
                        memoryUsage: sample.memoryUsage,
                        cpuSpeedEstimateGhz: estimateProcessCpuSpeedGhz(sample),
                        cpuSpeedMhz: sample.cpuSpeedMhz,
                      }))}
                    />
                  </article>
                  <article className="chart-card">
                    <div className="chart-heading">
                      <div>
                        <p className="eyebrow">PROCESS RAM</p>
                        <h2>RAM usage</h2>
                      </div>
                    </div>
                    <MetricChart
                      color="#18b89a"
                      label="RAM"
                      samples={processHistory.map((sample) => ({
                        sampledAt: sample.sampledAt,
                        value: sample.memoryUsage,
                        cpuUsage: sample.cpuUsage,
                        memoryUsage: sample.memoryUsage,
                        cpuSpeedEstimateGhz: estimateProcessCpuSpeedGhz(sample),
                        cpuSpeedMhz: sample.cpuSpeedMhz,
                      }))}
                    />
                  </article>
                  <article className="chart-card">
                    <div className="chart-heading">
                      <div>
                        <p className="eyebrow">PROCESS CPU SPEED</p>
                        <h2>Estimated CPU speed</h2>
                      </div>
                    </div>
                    <MetricChart
                      color="#e59d38"
                      label="Estimated CPU speed"
                      samples={processHistory.flatMap((sample) => {
                        const estimatedSpeed =
                          estimateProcessCpuSpeedGhz(sample);
                        return estimatedSpeed === null
                          ? []
                          : [
                              {
                                sampledAt: sample.sampledAt,
                                value: estimatedSpeed,
                                cpuUsage: sample.cpuUsage,
                                memoryUsage: sample.memoryUsage,
                                cpuSpeedMhz: sample.cpuSpeedMhz,
                                cpuSpeedEstimateGhz: estimatedSpeed,
                              },
                            ];
                      })}
                      valueUnit="ghz"
                    />
                  </article>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <footer className="page-footer">
        <span>
          {data.lastUpdated
            ? `Last sample ${new Date(data.lastUpdated).toLocaleTimeString()}`
            : "Waiting for system samples"}
        </span>
        <span>
          Sampling every 3 seconds <span className="footer-separator">·</span>{" "}
          {data.samples.length} points shown
        </span>
      </footer>
    </main>
  );
}
