type ProcessSparklineProps = {
  color: string;
  label: string;
  values: number[];
};

/** Draws a compact trend line for one process metric history. */
export function ProcessSparkline({
  color,
  label,
  values,
}: ProcessSparklineProps) {
  const width = 120;
  const height = 30;
  const maxValue = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = values.length > 1 ? (index / (values.length - 1)) * width : width;
      const y = height - 3 - (Math.min(value, maxValue) / maxValue) * (height - 7);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      aria-label={`${label} trend over ${values.length} samples`}
      className="process-sparkline"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>
        {label}: {values.length} samples
        {values.length > 0 ? `, latest ${values[values.length - 1].toFixed(2)}%` : ""}
      </title>
      {values.length > 1 && (
        <polyline
          fill="none"
          points={points}
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      )}
      {values.length === 1 && (
        <circle
          cx={width}
          cy={height - 3 - (Math.min(values[0], maxValue) / maxValue) * (height - 7)}
          fill={color}
          r="2"
        />
      )}
    </svg>
  );
}
