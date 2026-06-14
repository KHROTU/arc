export function helper(): string {
  return "Arc Enhanced Assistant";
}

export function countLines(text: string): number {
  return text.split("\n").length;
}

export function formatResult(ok: boolean, message: string): string {
  const status = ok ? "PASS" : "FAIL";
  return `[${status}] ${message}`;
}

export function getVersion(): string {
  return "v0.1.0";
}
