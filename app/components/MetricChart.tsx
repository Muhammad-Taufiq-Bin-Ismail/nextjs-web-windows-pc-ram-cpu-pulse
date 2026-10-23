import { useRef, useState } from "react";

type MetricChartProps = {
  color: string;
  label: string;
  samples: Array<{
    sampledAt: number;
    value: number;
    companionValue?: number;
    companionLabel?: string;
  }>;
  onSampleClick?: (sample: { sampledAt: number; value: number }) => void;
  onSelectRange?: (range: { start: number; end: number }) => void;
};

const chartWidth = 900;
const chartHeight = 250;
const padding = { top: 16, right: 18, bottom: 34, left: 42 };
const plotWidth = chartWidth - padding.left - padding.right;
const plotHeight = chartHeight - padding.top - padding.bottom;

/** Renders resource usage samples as a responsive SVG line chart. */
export function MetricChart({
  color,
  label,
  samples,
  onSampleClick,
  onSelectRange,
}: MetricChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dragSelection, setDragSelection] = useState<[number, number] | null>(
    null,
  );
  const dragStartIndex = useRef<number | null>(null);
  const didDrag = useRef(false);
  /** Maps a pointer's horizontal position to its nearest chart sample. */
  const getIndexAtPointer = (clientX: number, bounds: DOMRect) => {
    const svgX = ((clientX - bounds.left) / bounds.width) * chartWidth;
    const pointRatio = Math.max(
      0,
      Math.min(1, (svgX - padding.left) / plotWidth),
    );
    return samples.length > 0
      ? Math.round(pointRatio * (samples.length - 1))
      : null;
  };
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
        className={[
          "metric-chart",
          onSampleClick && "chart-clickable",
          onSelectRange && "chart-range-selectable",
        ]
          .filter(Boolean)
          .join(" ")}
        role="img"
        aria-label={`${label} usage chart with ${samples.length} samples${onSampleClick ? "; click to view processes at a sample" : ""}`}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        onClick={() => {
          if (didDrag.current) {
            didDrag.current = false;
            return;
          }
          if (hoveredIndex !== null && onSampleClick) {
            onSampleClick(samples[hoveredIndex]);
          }
        }}
        onPointerDown={(event) => {
          if (!onSelectRange || samples.length < 2) return;
          const index = getIndexAtPointer(
            event.clientX,
            event.currentTarget.getBoundingClientRect(),
          );
          if (index === null) return;
          dragStartIndex.current = index;
          didDrag.current = false;
          setDragSelection([index, index]);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const index = getIndexAtPointer(event.clientX, bounds);
          setHoveredIndex(index);
          if (index !== null && dragStartIndex.current !== null) {
            setDragSelection([dragStartIndex.current, index]);
            if (Math.abs(dragStartIndex.current - index) > 0) {
              didDrag.current = true;
            }
          }
        }}
        onPointerUp={(event) => {
          const startIndex = dragStartIndex.current;
          const index = getIndexAtPointer(
            event.clientX,
            event.currentTarget.getBoundingClientRect(),
          );
          if (
            startIndex !== null &&
            index !== null &&
            startIndex !== index &&
            onSelectRange
          ) {
            didDrag.current = true;
            const first = samples[Math.min(startIndex, index)].sampledAt;
            const last = samples[Math.max(startIndex, index)].sampledAt;
            onSelectRange({ start: first, end: last });
          }
          dragStartIndex.current = null;
          setDragSelection(null);
        }}
        onPointerCancel={() => {
          dragStartIndex.current = null;
          setDragSelection(null);
        }}
        onPointerLeave={() => {
          if (dragStartIndex.current === null) setHoveredIndex(null);
        }}
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
            {dragSelection && (
              <rect
                className="chart-selection-zone"
                x={
                  padding.left +
                  (Math.min(...dragSelection) / (samples.length - 1)) *
                    plotWidth
                }
                y={padding.top}
                width={
                  (Math.abs(dragSelection[1] - dragSelection[0]) /
                    (samples.length - 1)) *
                  plotWidth
                }
                height={plotHeight}
              />
            )}
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
          {hoveredPoint.companionValue !== undefined && (
            <span>
              {hoveredPoint.companionLabel}:{" "}
              {hoveredPoint.companionValue.toFixed(2)}%
            </span>
          )}
          <span>{new Date(hoveredPoint.sampledAt).toLocaleString()}</span>
          {onSampleClick && <span>Click to view process usage</span>}
          {onSelectRange && <span>Drag to zoom into a time range</span>}
        </div>
      )}
      {samples.length === 0 && (
        <p className="chart-empty">Waiting for the first sample...</p>
      )}
    </div>
  );
}
