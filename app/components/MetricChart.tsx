import { useState } from "react";

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

/** Renders resource usage samples as a responsive SVG line chart. */
export function MetricChart({ color, label, samples }: MetricChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const points = samples.map((sample, index) => {
    const x =
      padding.left +
      (samples.length > 1 ? (index / (samples.length - 1)) * plotWidth : 0);
    const y = padding.top + (1 - sample.value / 100) * plotHeight;
    return `${x},${y}`;
  });
  const hoveredPoint =
    hoveredIndex === null ? null : samples[hoveredIndex] ?? null;
  const hoveredCoordinates =
    hoveredIndex === null ? null : points[hoveredIndex]?.split(",").map(Number);

  return (
    <div className="chart-wrap">
      <svg
        aria-label={`${label} usage chart with ${samples.length} samples`}
        className="metric-chart"
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const svgX =
            ((event.clientX - bounds.left) / bounds.width) * chartWidth;
          const pointRatio = Math.max(
            0,
            Math.min(1, (svgX - padding.left) / plotWidth),
          );
          setHoveredIndex(
            samples.length > 0
              ? Math.round(pointRatio * (samples.length - 1))
              : null,
          );
        }}
        onPointerLeave={() => setHoveredIndex(null)}
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
            <rect
              className="chart-hover-target"
              height={plotHeight}
              width={plotWidth}
              x={padding.left}
              y={padding.top}
            />
            <polyline
              fill="none"
              points={points.join(" ")}
              stroke={color}
              strokeLinejoin="round"
              strokeWidth="3"
            />
            {hoveredPoint && hoveredCoordinates && (
              <>
                <line
                  className="chart-hover-line"
                  x1={hoveredCoordinates[0]}
                  x2={hoveredCoordinates[0]}
                  y1={padding.top}
                  y2={chartHeight - padding.bottom}
                />
                <circle
                  cx={hoveredCoordinates[0]}
                  cy={hoveredCoordinates[1]}
                  fill={color}
                  r="5"
                  stroke="white"
                  strokeWidth="2"
                />
              </>
            )}
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
      {hoveredPoint && (
        <div className="chart-tooltip" role="status">
          <strong>{hoveredPoint.value.toFixed(2)}%</strong>
          <span>{new Date(hoveredPoint.sampledAt).toLocaleString()}</span>
        </div>
      )}
      {samples.length === 0 && (
        <p className="chart-empty">Waiting for the first sample...</p>
      )}
    </div>
  );
}
