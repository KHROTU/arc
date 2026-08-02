import * as dns from "node:dns/promises";
import * as net from "node:net";
const MAX_REDIRECTS = 5;
export const MAX_HTTP_BODY_BYTES = 1024 * 1024;
function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113) || a >= 224;
}
function privateIpv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("fec") || value.startsWith("fed") || value.startsWith("fee") || value.startsWith("fef") || value.startsWith("ff") || value.startsWith("2001:db8")) return true;
  if (value.startsWith("::ffff:")) return privateIpv4(value.slice(7));
  return false;
}
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  return family === 4 ? privateIpv4(address) : family === 6 ? privateIpv6(address) : true;
}
export interface UrlPolicy {
  allowPrivate?: boolean;
  allowHttpLoopback?: boolean;
  sameOrigin?: string;
}
export async function assertSafeUrl(raw: string | URL, policy: UrlPolicy = {}): Promise<URL> {
  const url = raw instanceof URL ? new URL(raw.toString()) : new URL(raw);
  if (url.username || url.password) throw new Error("URL userinfo is not allowed.");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`URL scheme '${url.protocol}' is not allowed.`);
  if (policy.sameOrigin && url.origin !== new URL(policy.sameOrigin).origin) throw new Error(`Cross-origin endpoint is not allowed: ${url.origin}`);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literal = net.isIP(hostname) ? [hostname] : (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  const hasPrivate = literal.some(isPrivateAddress);
  if (hasPrivate && !policy.allowPrivate) throw new Error(`Private or reserved network destination is blocked: ${url.hostname}`);
  if (url.protocol === "http:" && !(policy.allowHttpLoopback && literal.every((address) => address === "127.0.0.1" || address === "::1"))) {
    throw new Error("Plain HTTP is allowed only for an explicitly permitted loopback service.");
  }
  return url;
}
export async function safeFetch(raw: string | URL, init: RequestInit = {}, policy: UrlPolicy = {}): Promise<Response> {
  let url = await assertSafeUrl(raw, policy);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetch(url, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error("Redirect response is missing Location.");
    if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects.");
    url = await assertSafeUrl(new URL(location, url), policy);
  }
  throw new Error("Too many redirects.");
}
export async function readBodyLimited(response: Response, maxBytes = MAX_HTTP_BODY_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`HTTP response exceeded ${maxBytes} bytes.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}