type MetricChartProps = {
  color: string;
  label: string;
  samples: Array<{ sampledAt: number; value: number }>;
};

const chartWidth = 900;
const chartHeight = 250;
const padding = { top: 16, right: 18, bottom: 34, left: 42 };
const plotWidth = chartWidth - padding.left - padding.right;
const plotHeight = chartHeight - padding.top - padding.bottom;

export function MetricChart({ color, label, samples }: MetricChartProps) {
  const points = samples.map((sample, index) => {
    const x =
      padding.left +
      (samples.length > 1 ? (index / (samples.length - 1)) * plotWidth : 0);
    const y = padding.top + (1 - sample.value / 100) * plotHeight;
    return `${x},${y}`;
  });

  return (
    <div className="chart-wrap">
      <svg
        aria-label={`${label} usage over the last ${samples.length * 3} seconds`}
        className="metric-chart"
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        {[0, 25, 50, 75, 100].map((value) => {
          const y = padding.top + (1 - value / 100) * plotHeight;
          return (
            <g key={value}>
              <line
                className="chart-grid"
                x1={padding.left}
                x2={chartWidth - padding.right}
                y1={y}
                y2={y}
              />
              <text className="chart-axis-label" textAnchor="end" x="34" y={y + 4}>
                {value}%
              </text>
            </g>
          );
        })}
        {points.length > 0 && (
          <>
            <polyline
              fill="none"
              points={points.join(" ")}
              stroke={color}
              strokeLinejoin="round"
              strokeWidth="3"
            />
            {samples.map((sample, index) => {
              const [x, y] = points[index].split(",");
              return (
                <circle
                  key={sample.sampledAt}
                  cx={x}
                  cy={y}
                  fill={color}
                  r={index === samples.length - 1 ? 4 : 2}
                >
                  <title>
                    {new Date(sample.sampledAt).toLocaleTimeString()}:{" "}
                    {sample.value.toFixed(1)}%
                  </title>
                </circle>
              );
            })}
          </>
        )}
        <text
          className="chart-axis-label"
          textAnchor="start"
          x={padding.left}
          y={chartHeight - 8}
        >
          {samples[0] ? new Date(samples[0].sampledAt).toLocaleTimeString() : ""}
        </text>
        <text
          className="chart-axis-label"
          textAnchor="end"
          x={chartWidth - padding.right}
          y={chartHeight - 8}
        >
          {samples.length > 0
            ? new Date(samples[samples.length - 1].sampledAt).toLocaleTimeString()
            : ""}
        </text>
      </svg>
      {samples.length === 0 && (
        <p className="chart-empty">Waiting for the first sample...</p>
      )}
    </div>
  );
}
