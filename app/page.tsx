"use client";

import { useEffect, useState } from "react";
import { MetricChart } from "./components/MetricChart";

type MetricSample = {
  sampledAt: number;
  cpuUsage: number;
  memoryUsage: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
};

type MetricsResponse = {
  samples: MetricSample[];
  lastUpdated: number | null;
};

/** Formats a byte count as gibibytes for the dashboard. */
function formatBytes(bytes: number): string {
  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes.toFixed(1)} GB`;
}

/** Renders the live CPU and memory monitoring dashboard. */
export default function DashboardPage() {
  const [data, setData] = useState<MetricsResponse>({
    samples: [],
    lastUpdated: null,
  });
  const [error, setError] = useState<string | null>(null);

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
