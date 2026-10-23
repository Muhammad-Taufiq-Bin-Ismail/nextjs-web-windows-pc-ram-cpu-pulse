import { NextRequest, NextResponse } from "next/server";
import { getProcessSnapshotNear } from "../../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the closest retained process snapshot for a chart sample. */
export function GET(request: NextRequest) {
  const atValue = request.nextUrl.searchParams.get("at");
  const sampledAt = Number(atValue);
  if (!atValue || !Number.isSafeInteger(sampledAt) || sampledAt < 0) {
    return NextResponse.json(
      { error: "Provide a valid sample timestamp." },
      { status: 400 },
    );
  }

  return NextResponse.json(getProcessSnapshotNear(sampledAt), {
    headers: { "Cache-Control": "no-store" },
  });
}
