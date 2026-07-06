import { useState, useEffect, type ReactNode, type CSSProperties } from "react";
const cssEase = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export function Expand({ open, children, style }: { open: boolean; children: ReactNode; style?: CSSProperties }) {
  const [visible, setVisible] = useState(open);
  useEffect(() => {
    if (open) setVisible(true);
  }, [open]);
  if (!visible && !open) return null;
  return (
    <div
      style={{
        overflow: "hidden",
        maxHeight: open ? "3000px" : "0px",
        opacity: open ? 1 : 0,
        transition: `max-height 320ms ${cssEase}, opacity 250ms ${cssEase}`,
        ...style,
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "max-height" && !open) {
          setVisible(false);
        }
      }}
    >
      {children}
    </div>
  );
}
export function FadeSlideIn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        animation: "arc-fade-slide-in 300ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
      }}
    >
      {children}
    </div>
  );
}
export function ScaleIn({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        animation: "arc-scale-in 350ms cubic-bezier(0.34, 1.3, 0.64, 1) forwards",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
export function RotateArrow({ open, size = 13 }: { open: boolean; size?: number }) {
  const [rot, setRot] = useState(open ? 90 : 0);
  useEffect(() => { setRot(open ? 90 : 0); }, [open]);
  return (
    <span
      className="arc-proc-chevron"
      style={{
        transform: `rotate(${rot}deg)`,
        transition: `transform 250ms ${cssEase}`,
        display: "inline-flex",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </span>
  );
}