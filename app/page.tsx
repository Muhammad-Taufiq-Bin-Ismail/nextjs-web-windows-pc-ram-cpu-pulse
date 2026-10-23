"use client";

import { type FormEvent, useEffect, useState } from "react";
import { MetricChart } from "./components/MetricChart";
import { ProcessSparkline } from "./components/ProcessSparkline";

type MetricSample = {
  sampledAt: number;
  cpuUsage: number;
  memoryUsage: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
};

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

type MetricsResponse = {
  samples: MetricSample[];
  processes: ProcessMetric[];
  processHistory: ProcessHistory[];
  lastUpdated: number | null;
};

type ProcessSortColumn = "name" | "pid" | "cpuUsage" | "memoryUsedBytes" | "memoryUsage";
type SortDirection = "ascending" | "descending";

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
  return `${hours}:${minutes}`;
}

/** Renders the live CPU and memory monitoring dashboard. */
export default function DashboardPage() {
  const [data, setData] = useState<MetricsResponse>({
    samples: [],
    processes: [],
    processHistory: [],
    lastUpdated: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [rangeStartDate, setRangeStartDate] = useState("");
  const [rangeStartTime, setRangeStartTime] = useState("");
  const [rangeEndDate, setRangeEndDate] = useState("");
  const [rangeEndTime, setRangeEndTime] = useState("");
  const [rangeSamples, setRangeSamples] = useState<MetricSample[]>([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<ProcessSortColumn>("cpuUsage");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("descending");

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
  const chartSamples = (key: "cpuUsage" | "memoryUsage") =>
    data.samples.map((sample) => ({
      sampledAt: sample.sampledAt,
      value: sample[key],
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
      </section>

      <section aria-label="Usage history" className="charts-grid">
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
            samples={chartSamples("memoryUsage")}
          />
          <div className="chart-legend">
            <span className="legend-dot memory-dot" />
            Memory used
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
          Choose local start and end dates and times to view overall system CPU
          and RAM usage.
        </p>
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
        <div className="charts-grid range-charts">
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
              samples={rangeSamples.map((sample) => ({
                sampledAt: sample.sampledAt,
                value: sample.cpuUsage,
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
              samples={rangeSamples.map((sample) => ({
                sampledAt: sample.sampledAt,
                value: sample.memoryUsage,
              }))}
            />
          </article>
        </div>
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
                    <td className="process-pid">{process.pid}</td>
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
