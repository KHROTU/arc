import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Search, ChevronDown } from "lucide-react";
import type { ModelDescriptor, ModelTier } from "@arc/host/protocol";
const TIER_ORDER: Record<ModelTier, number> = { heavy: 0, default: 1, light: 2, free: 3 };
const TIER_LABELS: Record<ModelTier, string> = { heavy: "heavy", default: "default", light: "light", free: "free" };
type Props = {
  models: ModelDescriptor[];
  currentModelId: string;
  onSelect: (modelId: string) => void;
  variant: "sidebar" | "fullscreen";
};
export default function ModelPicker({ models, currentModelId, onSelect, variant }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sorted = useMemo(
    () => [...models].sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99)),
    [models],
  );
  const filtered = useMemo(() => {
    if (!query.trim()) return sorted;
    const q = query.toLowerCase();
    return sorted.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.tier.toLowerCase().includes(q),
    );
  }, [sorted, query]);
  const current = models.find((m) => m.id === currentModelId);
  const reset = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIdx(0);
  }, []);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        reset();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, reset]);
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);
  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % Math.max(1, filtered.length));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[activeIdx]) {
          onSelect(filtered[activeIdx].id);
          reset();
        }
        break;
      case "Escape":
        e.preventDefault();
        reset();
        break;
    }
  };
  const selectModel = (id: string) => {
    onSelect(id);
    reset();
  };
  if (models.length === 0) {
    return (
      <div className="arc-model">
        <button className="arc-model-trigger arc-model-trigger-empty">
          <span className="arc-model-trigger-label">no models — open settings</span>
        </button>
      </div>
    );
  }
  return (
    <div className="arc-model" ref={containerRef}>
      <button
        className={`arc-model-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={current ? `${current.label} · ${TIER_LABELS[current.tier]}` : "Select model"}
      >
        <span className="arc-model-trigger-label">
          {current ? current.label : "Select model"}
        </span>
        <ChevronDown size={12} className={`arc-model-trigger-chevron ${open ? "is-open" : ""}`} />
      </button>
      {open && (
        <div className={`arc-model-dropdown arc-model-dropdown-${variant}`}>
          <div className="arc-model-dropdown-search">
            <Search size={13} className="arc-model-dropdown-search-icon" />
            <input
              ref={inputRef}
              className="arc-model-dropdown-search-input"
              placeholder="Search models…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKey}
            />
          </div>
          <div className="arc-model-dropdown-list" ref={listRef}>
            {filtered.length === 0 ? (
              <div className="arc-model-dropdown-empty">No models match "{query}"</div>
            ) : (
              filtered.map((m, i) => (
                <button
                  key={m.id}
                  className={`arc-model-dropdown-item ${m.id === currentModelId ? "is-selected" : ""} ${i === activeIdx ? "is-active" : ""}`}
                  onClick={() => selectModel(m.id)}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <span className="arc-model-dropdown-item-label">{m.label}</span>
                  <span className="arc-model-dropdown-item-tier">
                    {TIER_LABELS[m.tier]}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}