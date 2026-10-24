const defaultCpuSpeedThresholdGhz = 4.15;

/** Reads the configured CPU speed alert threshold in GHz. */
function readCpuSpeedThresholdGhz(): number {
  const configuredThreshold = process.env.CPU_SPEED_THRESHOLD_GHZ;
  if (configuredThreshold === undefined || configuredThreshold.trim() === "") {
    return defaultCpuSpeedThresholdGhz;
  }

  const threshold = Number(configuredThreshold);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error(
      "CPU_SPEED_THRESHOLD_GHZ must be a positive finite number.",
    );
  }
  return threshold;
}

export const cpuSpeedThresholdGhz = readCpuSpeedThresholdGhz();
