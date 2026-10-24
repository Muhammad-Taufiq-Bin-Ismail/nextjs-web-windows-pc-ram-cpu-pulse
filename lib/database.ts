import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cpuSpeedThresholdGhz } from "./config";

export type MetricSample = {
  sampledAt: number;
  cpuUsage: number;
  cpuSpeedMhz: number;
  memoryUsage: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
};

export type CpuSpeedAlert = {
  id: number;
  triggeredAt: number;
  cpuSpeedMhz: number;
  thresholdGhz: number;
};

export type ProcessMetric = {
  pid: number;
  name: string;
  startedAt: string;
  cpuUsage: number;
  memoryUsedBytes: number;
  memoryUsage: number;
};

export type ProcessHistory = {
  pid: number;
  startedAt: string;
  samples: Array<{
    sampledAt: number;
    cpuUsage: number;
    memoryUsage: number;
  }>;
};

export type ProcessSnapshot = {
  sampledAt: number | null;
  processes: ProcessMetric[];
};

const databasePath = join(process.cwd(), "data", "pc-status.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA busy_timeout = 5000");
database.exec(`
  CREATE TABLE IF NOT EXISTS metric_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sampled_at INTEGER NOT NULL,
    cpu_usage REAL NOT NULL,
    cpu_speed_mhz REAL NOT NULL DEFAULT 0,
    memory_usage REAL NOT NULL,
    memory_used_bytes INTEGER NOT NULL,
    memory_total_bytes INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS metric_samples_sampled_at
    ON metric_samples (sampled_at);
  CREATE TABLE IF NOT EXISTS cpu_speed_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    triggered_at INTEGER NOT NULL,
    cpu_speed_mhz REAL NOT NULL,
    threshold_ghz REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cpu_speed_alerts_triggered_at
    ON cpu_speed_alerts (triggered_at);
  CREATE UNIQUE INDEX IF NOT EXISTS cpu_speed_alerts_triggered_threshold
    ON cpu_speed_alerts (triggered_at, threshold_ghz);
  CREATE TABLE IF NOT EXISTS process_snapshots (
    sampled_at INTEGER PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS process_samples (
    sampled_at INTEGER NOT NULL,
    pid INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    task_name TEXT NOT NULL,
    cpu_usage REAL NOT NULL,
    memory_used_bytes INTEGER NOT NULL,
    memory_usage REAL NOT NULL,
    PRIMARY KEY (sampled_at, pid, started_at)
  );
  CREATE INDEX IF NOT EXISTS process_samples_sampled_at
    ON process_samples (sampled_at);
`);
const metricColumns = database
  .prepare("PRAGMA table_info(metric_samples)")
  .all() as Array<{ name: string }>;
if (!metricColumns.some((column) => column.name === "cpu_speed_mhz")) {
  database.exec(
    "ALTER TABLE metric_samples ADD COLUMN cpu_speed_mhz REAL NOT NULL DEFAULT 0",
  );
}
const backfillCpuSpeedAlerts = database.prepare(`
  INSERT OR IGNORE INTO cpu_speed_alerts (
    triggered_at, cpu_speed_mhz, threshold_ghz
  )
  SELECT sampled_at, cpu_speed_mhz, ?
  FROM (
    SELECT
      sampled_at,
      cpu_speed_mhz,
      LAG(cpu_speed_mhz) OVER (ORDER BY sampled_at) AS previous_cpu_speed_mhz
    FROM metric_samples
  )
  WHERE cpu_speed_mhz > ? * 1_000
    AND (
      previous_cpu_speed_mhz IS NULL
      OR previous_cpu_speed_mhz <= ? * 1_000
    )
`);
const backfilledAlertThresholds = new Set<number>();

const insertSample = database.prepare(`
  INSERT INTO metric_samples (
    sampled_at, cpu_usage, cpu_speed_mhz, memory_usage, memory_used_bytes, memory_total_bytes
  ) VALUES (?, ?, ?, ?, ?, ?)
`);
const latestCpuSpeedSample = database.prepare(`
  SELECT cpu_speed_mhz AS cpuSpeedMhz
  FROM metric_samples
  ORDER BY sampled_at DESC
  LIMIT 1
`);
const insertCpuSpeedAlert = database.prepare(`
  INSERT OR IGNORE INTO cpu_speed_alerts (
    triggered_at, cpu_speed_mhz, threshold_ghz
  ) VALUES (?, ?, ?)
`);
const latestCpuSpeedAlerts = database.prepare(`
  SELECT
    id,
    triggered_at AS triggeredAt,
    cpu_speed_mhz AS cpuSpeedMhz,
    threshold_ghz AS thresholdGhz
  FROM cpu_speed_alerts
  WHERE cpu_speed_mhz > ? * 1_000
  ORDER BY triggered_at DESC, id DESC
  LIMIT ?
`);

const latestSamples = database.prepare(`
  SELECT
    sampled_at AS sampledAt,
    cpu_usage AS cpuUsage,
    cpu_speed_mhz AS cpuSpeedMhz,
    memory_usage AS memoryUsage,
    memory_used_bytes AS memoryUsedBytes,
    memory_total_bytes AS memoryTotalBytes
  FROM (
    SELECT sampled_at, cpu_usage, cpu_speed_mhz, memory_usage, memory_used_bytes, memory_total_bytes
    FROM metric_samples
    ORDER BY sampled_at DESC
    LIMIT ?
  )
  ORDER BY sampled_at ASC
`);
const metricSamplesBetween = database.prepare(`
  SELECT
    sampled_at AS sampledAt,
    cpu_usage AS cpuUsage,
    cpu_speed_mhz AS cpuSpeedMhz,
    memory_usage AS memoryUsage,
    memory_used_bytes AS memoryUsedBytes,
    memory_total_bytes AS memoryTotalBytes
  FROM metric_samples
  WHERE sampled_at >= ? AND sampled_at <= ?
  ORDER BY sampled_at ASC
`);
const processHistoryBetween = database.prepare(`
  SELECT
    process_samples.sampled_at AS sampledAt,
    process_samples.pid,
    process_samples.started_at AS startedAt,
    process_samples.task_name AS name,
    process_samples.cpu_usage AS cpuUsage,
    process_samples.memory_used_bytes AS memoryUsedBytes,
    process_samples.memory_usage AS memoryUsage,
    COALESCE(metric_samples.cpu_speed_mhz, 0) AS cpuSpeedMhz
  FROM process_samples
  LEFT JOIN metric_samples
    ON metric_samples.sampled_at = process_samples.sampled_at
  WHERE process_samples.pid = ?
    AND process_samples.started_at = ?
    AND process_samples.sampled_at >= ?
    AND process_samples.sampled_at <= ?
  ORDER BY process_samples.sampled_at ASC
`);

const insertProcessSnapshot = database.prepare(
  "INSERT INTO process_snapshots (sampled_at) VALUES (?)",
);
const insertProcessSample = database.prepare(`
  INSERT INTO process_samples (
    sampled_at, pid, started_at, task_name, cpu_usage, memory_used_bytes, memory_usage
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const deleteOldProcessSamples = database.prepare(
  "DELETE FROM process_samples WHERE sampled_at < ?",
);
const deleteOldProcessSnapshots = database.prepare(
  "DELETE FROM process_snapshots WHERE sampled_at < ?",
);
const latestProcessSamples = database.prepare(`
  SELECT
    pid,
    task_name AS name,
    started_at AS startedAt,
    cpu_usage AS cpuUsage,
    memory_used_bytes AS memoryUsedBytes,
    memory_usage AS memoryUsage
  FROM process_samples
  WHERE sampled_at = (SELECT MAX(sampled_at) FROM process_snapshots)
  ORDER BY cpu_usage DESC, memory_used_bytes DESC
`);
const nearestProcessSnapshot = database.prepare(`
  SELECT sampled_at AS sampledAt
  FROM process_snapshots
  ORDER BY ABS(sampled_at - ?)
  LIMIT 1
`);
const processSamplesAt = database.prepare(`
  SELECT
    pid,
    task_name AS name,
    started_at AS startedAt,
    cpu_usage AS cpuUsage,
    memory_used_bytes AS memoryUsedBytes,
    memory_usage AS memoryUsage
  FROM process_samples
  WHERE sampled_at = ?
  ORDER BY cpu_usage DESC, memory_used_bytes DESC
`);
const latestProcessHistory = database.prepare(`
  SELECT
    history.sampled_at AS sampledAt,
    history.pid,
    history.started_at AS startedAt,
    history.cpu_usage AS cpuUsage,
    history.memory_usage AS memoryUsage
  FROM process_samples AS history
  WHERE history.sampled_at IN (
    SELECT sampled_at FROM process_snapshots ORDER BY sampled_at DESC LIMIT ?
  )
  AND EXISTS (
    SELECT 1
    FROM process_samples AS current
    WHERE current.sampled_at = (SELECT MAX(sampled_at) FROM process_snapshots)
      AND current.pid = history.pid
      AND current.started_at = history.started_at
  )
  ORDER BY history.pid, history.started_at, history.sampled_at
`);

/** Persists metrics and records a CPU speed alert when the threshold is crossed. */
export function saveMetricSample(
  sample: MetricSample,
  thresholdGhz: number,
): void {
  const previousSample = latestCpuSpeedSample.get() as
    | { cpuSpeedMhz: number }
    | undefined;
  database.exec("BEGIN");
  try {
    insertSample.run(
      sample.sampledAt,
      sample.cpuUsage,
      sample.cpuSpeedMhz,
      sample.memoryUsage,
      sample.memoryUsedBytes,
      sample.memoryTotalBytes,
    );
    const currentSpeedGhz = sample.cpuSpeedMhz / 1_000;
    if (
      currentSpeedGhz > thresholdGhz &&
      (!previousSample || previousSample.cpuSpeedMhz / 1_000 <= thresholdGhz)
    ) {
      insertCpuSpeedAlert.run(
        sample.sampledAt,
        sample.cpuSpeedMhz,
        thresholdGhz,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  console.log(`Saved metric sample: ${JSON.stringify(sample)}`);
}

/** Returns the most recent CPU speed threshold-crossing events. */
export function getLatestCpuSpeedAlerts(
  thresholdGhz: number,
  limit = 10,
): CpuSpeedAlert[] {
  if (!backfilledAlertThresholds.has(thresholdGhz)) {
    backfillCpuSpeedAlerts.run(thresholdGhz, thresholdGhz, thresholdGhz);
    backfilledAlertThresholds.add(thresholdGhz);
  }
  return latestCpuSpeedAlerts.all(thresholdGhz, limit) as CpuSpeedAlert[];
}

/** Saves one process snapshot and removes data older than the retention period. */
export function saveProcessSamples(
  sampledAt: number,
  samples: ProcessMetric[],
  retentionMs = 15 * 60 * 1_000,
): void {
  database.exec("BEGIN");
  try {
    insertProcessSnapshot.run(sampledAt);
    for (const sample of samples) {
      insertProcessSample.run(
        sampledAt,
        sample.pid,
        sample.startedAt,
        sample.name,
        sample.cpuUsage,
        sample.memoryUsedBytes,
        sample.memoryUsage,
      );
    }
    const retentionCutoff = sampledAt - retentionMs;
    deleteOldProcessSamples.run(retentionCutoff);
    deleteOldProcessSnapshots.run(retentionCutoff);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** Returns the most recent samples in chronological order. */
export function getLatestMetricSamples(limit = 120): MetricSample[] {
  return latestSamples.all(limit) as MetricSample[];
}

/** Returns system metric samples recorded inside the inclusive time range. */
export function getMetricSamplesBetween(
  startTime: number,
  endTime: number,
): MetricSample[] {
  return metricSamplesBetween.all(startTime, endTime) as MetricSample[];
}

/** Returns CPU and RAM history for one process instance within a time range. */
export function getProcessHistoryBetween(
  pid: number,
  startedAt: string,
  startTime: number,
  endTime: number,
): Array<ProcessMetric & { sampledAt: number; cpuSpeedMhz: number }> {
  return processHistoryBetween.all(
    pid,
    startedAt,
    startTime,
    endTime,
  ) as Array<ProcessMetric & { sampledAt: number; cpuSpeedMhz: number }>;
}

/** Returns per-process metrics from the latest recorded snapshot. */
export function getLatestProcessSamples(): ProcessMetric[] {
  return latestProcessSamples.all() as ProcessMetric[];
}

/** Finds the nearest process snapshot when it is within the allowed five seconds. */
export function getProcessSnapshotNear(
  sampledAt: number,
  toleranceMs = 5_000,
): ProcessSnapshot {
  const snapshot = nearestProcessSnapshot.get(sampledAt) as
    | { sampledAt: number }
    | undefined;
  if (!snapshot || Math.abs(snapshot.sampledAt - sampledAt) > toleranceMs) {
    return { sampledAt: null, processes: [] };
  }
  return {
    sampledAt: snapshot.sampledAt,
    processes: processSamplesAt.all(snapshot.sampledAt) as ProcessMetric[],
  };
}

/** Returns per-process CPU and RAM history from the latest snapshots. */
export function getLatestProcessHistory(limit = 120): ProcessHistory[] {
  const rows = latestProcessHistory.all(limit) as Array<{
    sampledAt: number;
    pid: number;
    startedAt: string;
    cpuUsage: number;
    memoryUsage: number;
  }>;
  const historyByProcess = new Map<string, ProcessHistory>();

  for (const row of rows) {
    const key = `${row.pid}:${row.startedAt}`;
    let history = historyByProcess.get(key);
    if (!history) {
      history = { pid: row.pid, startedAt: row.startedAt, samples: [] };
      historyByProcess.set(key, history);
    }
    history.samples.push({
      sampledAt: row.sampledAt,
      cpuUsage: row.cpuUsage,
      memoryUsage: row.memoryUsage,
    });
  }
  return Array.from(historyByProcess.values());
}
