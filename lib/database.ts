import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MetricSample = {
  sampledAt: number;
  cpuUsage: number;
  memoryUsage: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
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

const databasePath = join(process.cwd(), "data", "pc-status.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  CREATE TABLE IF NOT EXISTS metric_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sampled_at INTEGER NOT NULL,
    cpu_usage REAL NOT NULL,
    memory_usage REAL NOT NULL,
    memory_used_bytes INTEGER NOT NULL,
    memory_total_bytes INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS metric_samples_sampled_at
    ON metric_samples (sampled_at);
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

const insertSample = database.prepare(`
  INSERT INTO metric_samples (
    sampled_at, cpu_usage, memory_usage, memory_used_bytes, memory_total_bytes
  ) VALUES (?, ?, ?, ?, ?)
`);

const latestSamples = database.prepare(`
  SELECT
    sampled_at AS sampledAt,
    cpu_usage AS cpuUsage,
    memory_usage AS memoryUsage,
    memory_used_bytes AS memoryUsedBytes,
    memory_total_bytes AS memoryTotalBytes
  FROM (
    SELECT sampled_at, cpu_usage, memory_usage, memory_used_bytes, memory_total_bytes
    FROM metric_samples
    ORDER BY sampled_at DESC
    LIMIT ?
  )
  ORDER BY sampled_at ASC
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

/** Persists one CPU and memory measurement in the local SQLite database. */
export function saveMetricSample(sample: MetricSample): void {
  insertSample.run(
    sample.sampledAt,
    sample.cpuUsage,
    sample.memoryUsage,
    sample.memoryUsedBytes,
    sample.memoryTotalBytes,
  );
  console.log(`Saved metric sample: ${JSON.stringify(sample)}`);
}

/** Saves one complete process snapshot and removes snapshots older than 15 minutes. */
export function saveProcessSamples(
  sampledAt: number,
  samples: ProcessMetric[],
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
    const retentionCutoff = sampledAt - 15 * 60 * 1_000;
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

/** Returns per-process metrics from the latest recorded snapshot. */
export function getLatestProcessSamples(): ProcessMetric[] {
  return latestProcessSamples.all() as ProcessMetric[];
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
