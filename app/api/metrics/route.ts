import { NextResponse } from "next/server";
import { getLatestMetricSamples } from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const samples = getLatestMetricSamples();
  return NextResponse.json(
    { samples, lastUpdated: samples.at(-1)?.sampledAt ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
