import { NextResponse } from "next/server";
import {
  getLatestMetricSamples,
  getLatestProcessHistory,
  getLatestProcessSamples,
} from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the latest saved metric samples without allowing response caching. */
export function GET() {
  const samples = getLatestMetricSamples();
  const processes = getLatestProcessSamples();
  const processHistory = getLatestProcessHistory(120);
  return NextResponse.json(
    {
      samples,
      processes,
      processHistory,
      lastUpdated: samples.at(-1)?.sampledAt ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
