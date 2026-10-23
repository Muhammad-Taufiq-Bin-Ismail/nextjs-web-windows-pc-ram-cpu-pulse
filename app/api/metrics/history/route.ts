import { NextRequest, NextResponse } from "next/server";
import { getMetricSamplesBetween } from "../../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns system metric samples for a validated millisecond time range. */
export function GET(request: NextRequest) {
  const startValue = request.nextUrl.searchParams.get("start");
  const endValue = request.nextUrl.searchParams.get("end");
  const start = Number(startValue);
  const end = Number(endValue);
  if (
    !startValue ||
    !endValue ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  ) {
    return NextResponse.json(
      { error: "Provide a valid start and end time range." },
      { status: 400 },
    );
  }

  const samples = getMetricSamplesBetween(start, end);
  return NextResponse.json(
    { samples },
    { headers: { "Cache-Control": "no-store" } },
  );
}
