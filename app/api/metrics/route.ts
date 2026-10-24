import { NextResponse } from "next/server";
import {
  getLatestCpuSpeedAlerts,
  getLatestMetricSamples,
  getLatestProcessHistory,
  getLatestProcessSamples,
} from "../../../lib/database";
import { cpuSpeedThresholdGhz } from "../../../lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the latest saved metric samples without allowing response caching. */
export function GET() {
  const samples = getLatestMetricSamples();
  const processes = getLatestProcessSamples();
  const processHistory = getLatestProcessHistory(120);
  const cpuSpeedAlerts = getLatestCpuSpeedAlerts();
  return NextResponse.json(
    {
      samples,
      processes,
      processHistory,
      cpuSpeedThresholdGhz,
      cpuSpeedAlerts,
      lastUpdated: samples.at(-1)?.sampledAt ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
