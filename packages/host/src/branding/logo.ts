type LogoKind = "mono" | "pride";
interface LogoSelection {
  kind: LogoKind;
  file: "arc-logo-mono.svg" | "arc-logo-pride.svg";
  alt: string;
}
const ALT = {
  mono: "Arc",
  pride: "Arc",
} as const;
const FILE = {
  mono: "arc-logo-mono.svg",
  pride: "arc-logo-pride.svg",
} as const;
export function pickLogo(now: Date = new Date()): LogoSelection {
  const kind: LogoKind = now.getUTCMonth() === 5 ? "pride" : "mono"; 
  return { kind, file: FILE[kind], alt: ALT[kind] };
}