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

/** Returns the most recent samples in chronological order. */
export function getLatestMetricSamples(limit = 120): MetricSample[] {
  return latestSamples.all(limit) as MetricSample[];
}
