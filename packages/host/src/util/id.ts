import { randomBytes } from "node:crypto";
export function shortId(len = 8): string {
  return randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}
export function slugId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "id"}-${Date.now().toString(36)}`;
}