import { useState, useRef, useEffect } from "react";
import { ChevronDown, Wrench, FileSearch, BugPlay, SearchCheck } from "lucide-react";
type ModeDef = { slug: string; description: string };
const MODE_ICONS: Record<string, React.ReactNode> = {
  plan: <FileSearch size={12} />,
  code: <Wrench size={12} />,
  debug: <BugPlay size={12} />,
  audit: <SearchCheck size={12} />,
};
const MODE_LABELS: Record<string, string> = {
  plan: "Plan",
  code: "Code",
  debug: "Debug",
  audit: "Audit",
};
type Props = {
  modes: ModeDef[];
  currentMode: string;
  onSelect: (mode: string) => void;
  variant?: "sidebar" | "fullscreen";
};
export default function ModePicker({ modes, currentMode, onSelect, variant }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const currentLabel = MODE_LABELS[currentMode] ?? currentMode;
  const currentIcon = MODE_ICONS[currentMode] ?? <Wrench size={12} />;
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
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
        setActiveIdx((i) => (i + 1) % Math.max(1, modes.length));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + modes.length) % Math.max(1, modes.length));
        break;
      case "Enter":
        e.preventDefault();
        if (modes[activeIdx]) {
          onSelect(modes[activeIdx].slug);
          setOpen(false);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  };
  if (modes.length === 0) return null;
  return (
    <div className="arc-mode" ref={containerRef} onKeyDown={handleKey}>
      <button
        className={`arc-mode-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={currentLabel + " mode"}
      >
        <span className="arc-mode-trigger-icon">{currentIcon}</span>
        <span className="arc-mode-trigger-label">{currentLabel}</span>
        <ChevronDown size={12} className={`arc-mode-trigger-chevron ${open ? "is-open" : ""}`} />
      </button>
      {open && (
        <div className="arc-mode-dropdown">
          <div className="arc-mode-dropdown-list" ref={listRef}>
            {modes.map((m, i) => (
              <button
                key={m.slug}
                className={`arc-mode-dropdown-item ${m.slug === currentMode ? "is-selected" : ""} ${i === activeIdx ? "is-active" : ""}`}
                onClick={() => { onSelect(m.slug); setOpen(false); }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className="arc-mode-dropdown-item-icon">
                  {MODE_ICONS[m.slug] ?? <Wrench size={12} />}
                </span>
                <span className="arc-mode-dropdown-item-label">{MODE_LABELS[m.slug] ?? m.slug}</span>
                {variant !== "sidebar" && <span className="arc-mode-dropdown-item-desc">{m.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}