import { createElement } from "react";
import { iconForModel, ICON_SVGS, DEFAULT_ICON } from "./model-icons";
type Props = {
  modelId?: string;
  size?: number;
  className?: string;
  title?: string;
};
export default function ModelIcon({ modelId, size = 14, className, title }: Props) {
  const name = modelId ? iconForModel(modelId) : DEFAULT_ICON;
  const svg = ICON_SVGS[name] ?? ICON_SVGS[DEFAULT_ICON];
  const paths = svg.paths.map((p, i) =>
    createElement("path", { key: i, d: p.d, ...(p.fillRule ? { fillRule: p.fillRule } : {}), ...(p.opacity ? { opacity: p.opacity } : {}) }),
  );
  const content = svg.transform
    ? createElement("g", { key: "fit", transform: svg.transform }, paths)
    : paths;
  return createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      className,
      title,
      fill: svg.mode === "fill" ? "currentColor" : "none",
      stroke: svg.mode === "stroke" ? "currentColor" : undefined,
      strokeWidth: svg.mode === "stroke" ? 1.5 : undefined,
      strokeLinecap: svg.mode === "stroke" ? ("round" as const) : undefined,
      strokeLinejoin: svg.mode === "stroke" ? ("round" as const) : undefined,
      "aria-hidden": true,
    },
    content,
  );
}