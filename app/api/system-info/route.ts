import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const processorInfoScript = `
$ErrorActionPreference = 'Stop'
$processors = @(Get-CimInstance -ClassName Win32_Processor)
if ($processors.Count -eq 0) {
  throw 'No processors were found.'
}
[pscustomobject]@{
  name = (($processors | Select-Object -ExpandProperty Name -Unique) -join ', ')
  coreCount = [int](($processors | Measure-Object -Property NumberOfCores -Sum).Sum)
  logicalProcessorCount = [int](($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum)
} | ConvertTo-Json -Compress
`;

/** Returns processor model and core counts reported by Windows CIM. */
export async function GET() {
  if (process.platform !== "win32") {
    return NextResponse.json(
      { error: "Processor information requires Windows PowerShell." },
      { status: 500 },
    );
  }

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", processorInfoScript],
      { windowsHide: true },
    );
    const result: unknown = JSON.parse(stdout);
    if (typeof result !== "object" || result === null) {
      throw new Error("Windows returned invalid processor information.");
    }
    const info = result as Record<string, unknown>;
    if (
      typeof info.name !== "string" ||
      info.name.trim() === "" ||
      typeof info.coreCount !== "number" ||
      !Number.isInteger(info.coreCount) ||
      info.coreCount < 1 ||
      typeof info.logicalProcessorCount !== "number" ||
      !Number.isInteger(info.logicalProcessorCount) ||
      info.logicalProcessorCount < 1
    ) {
      throw new Error("Windows returned invalid processor information.");
    }

    return NextResponse.json(
      {
        name: info.name,
        coreCount: info.coreCount,
        logicalProcessorCount: info.logicalProcessorCount,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to read processor information from Windows:", error);
    return NextResponse.json(
      { error: "Unable to read processor information from Windows." },
      { status: 500 },
    );
  }
}
