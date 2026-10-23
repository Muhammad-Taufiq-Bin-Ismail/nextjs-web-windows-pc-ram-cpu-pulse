import { NextRequest, NextResponse } from "next/server";
import { getProcessHistoryBetween } from "../../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns retained CPU and RAM history for one process instance. */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pidValue = params.get("pid");
  const startedAt = params.get("startedAt");
  const startValue = params.get("start");
  const endValue = params.get("end");
  const pid = Number(pidValue);
  const start = Number(startValue);
  const end = Number(endValue);

  if (
    !pidValue ||
    !Number.isSafeInteger(pid) ||
    pid < 0 ||
    !startedAt ||
    !startValue ||
    !endValue ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  ) {
    return NextResponse.json(
      { error: "Provide a valid PID, process start time, and date range." },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { samples: getProcessHistoryBetween(pid, startedAt, start, end) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
