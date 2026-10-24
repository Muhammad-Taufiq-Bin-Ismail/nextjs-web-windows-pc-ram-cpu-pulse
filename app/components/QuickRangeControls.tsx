import { useState } from "react";

type QuickRangeControlsProps = {
  maxMinutes?: number;
  onApply: (durationMs: number) => void;
};

/** Lets users apply a one-hour preset or a configurable minute range. */
export function QuickRangeControls({
  maxMinutes = 10_080,
  onApply,
}: QuickRangeControlsProps) {
  const [range, setRange] = useState<"hour" | "minutes">("hour");
  const [minutes, setMinutes] = useState("15");

  /** Applies the selected duration, clamped to the configured maximum. */
  const apply = () => {
    const parsedMinutes = Number(minutes);
    if (
      range === "minutes" &&
      !Number.isFinite(parsedMinutes)
    ) {
      return;
    }
    const durationMinutes =
      range === "hour"
        ? 60
        : Math.min(maxMinutes, Math.max(1, Math.floor(parsedMinutes)));
    onApply(durationMinutes * 60 * 1_000);
  };

  return (
    <div className="quick-range">
      <label>
        <span>Quick range</span>
        <select
          aria-label="Quick time range"
          onChange={(event) =>
            setRange(event.target.value as "hour" | "minutes")
          }
          value={range}
        >
          <option value="hour">Last hour</option>
          <option value="minutes">Last minutes</option>
        </select>
      </label>
      {range === "minutes" && (
        <label>
          <span>Minutes</span>
          <input
            aria-label="Quick range minutes"
            max={maxMinutes}
            min={1}
            onChange={(event) => setMinutes(event.target.value)}
            type="number"
            value={minutes}
          />
        </label>
      )}
      <button className="quick-range-button" onClick={apply} type="button">
        Apply
      </button>
    </div>
  );
}
