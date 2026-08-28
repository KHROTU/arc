export function errMsg(e: unknown): string {
  if (e === undefined || e === null) return "";
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}