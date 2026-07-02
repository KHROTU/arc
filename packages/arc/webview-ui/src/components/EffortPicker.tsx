import { useState, useRef, useEffect } from "react";
import { ChevronDown, Info } from "lucide-react";
type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: { value: Effort; label: string }[] = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
];
type Props = {
  effort: Effort;
  onSelect: (effort: Effort) => void;
  variant: "sidebar" | "fullscreen";
};
export default function EffortPicker({ effort, onSelect, variant }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isFull = variant === "fullscreen";
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const current = EFFORTS.find((e) => e.value === effort) ?? EFFORTS[4];
  return (
    <div className="arc-effort-picker" ref={ref}>
      <button
        className={`arc-effort-trigger ${isFull ? "arc-effort-trigger-full" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Reasoning effort"
      >
        <span className="arc-effort-value">{current.label}</span>
        <ChevronDown size={11} className={`arc-effort-chevron ${open ? "arc-effort-chevron-open" : ""}`} />
      </button>
      {open && (
        <div className="arc-effort-dropdown">
          <div className="arc-effort-header">
            <span>Reasoning effort</span>
            <span className="arc-info-icon" title="Some models may not support reasoning effort parameters. Unsupported values are automatically skipped.">
              <Info size={12} />
            </span>
          </div>
          {EFFORTS.map((e) => (
            <button
              key={e.value}
              className={`arc-effort-item ${e.value === effort ? "arc-effort-item-active" : ""}`}
              onClick={() => { onSelect(e.value); setOpen(false); }}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export type { Effort };