import * as fs from "node:fs";
import * as path from "node:path";
import { getArcDir } from "../arc-dir.js";
import { makeProxyDispatcher } from "../util/proxy.js";
import { readBodyLimited } from "../security/network.js";
export interface OrFrontEntry {
  slug?: string;
  name?: string;
  short_name?: string;
  author?: string;
  group?: string;
  context_length?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  hidden?: boolean;
  is_private?: boolean;
  supports_reasoning?: boolean;
}
export const OR_FRONT_URL = "https://openrouter.ai/api/frontend/v1/models";
const OR_FRONT_TTL_MS = 24 * 60 * 60 * 1000;
const OR_FRONT_MAX_BYTES = 16 * 1024 * 1024;
export interface OrFrontOptions {
  proxyUrl?: string;
  fetchImpl?: typeof fetch;
  cachePath?: string;
  ttlMs?: number;
}
let cache: { at: number; entries: OrFrontEntry[] } | undefined;
let inflight: Promise<OrFrontEntry[] | undefined> | undefined;
function defaultCachePath(): string {
  return path.join(getArcDir(), "or-front.json");
}
export function parseOrFront(json: unknown): OrFrontEntry[] {
  const arr = Array.isArray(json) ? json : (json as { data?: unknown } | undefined)?.data;
  return Array.isArray(arr) ? arr.filter((x): x is OrFrontEntry => !!x && typeof x === "object" && !Array.isArray(x)) : [];
}
export async function getOrFrontEntries(opts: OrFrontOptions = {}): Promise<OrFrontEntry[] | undefined> {
  const ttl = opts.ttlMs ?? OR_FRONT_TTL_MS;
  if (cache && Date.now() - cache.at < ttl) return cache.entries;
  if (!inflight) {
    inflight = (async () => {
      const cachePath = opts.cachePath ?? defaultCachePath();
      try {
        const parsed = JSON.parse(await fs.promises.readFile(cachePath, "utf8")) as { fetched?: unknown; data?: unknown };
        const fetched = typeof parsed.fetched === "number" ? parsed.fetched : undefined;
        const entries = parseOrFront(parsed.data);
        if (fetched && entries.length) {
          cache = { at: fetched, entries };
          if (Date.now() - fetched < ttl) return entries;
        }
      } catch {  }
      try {
        const fetchImpl = opts.fetchImpl ?? fetch;
        const init: RequestInit = { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) };
        if (opts.proxyUrl) (init as Record<string, unknown>).dispatcher = makeProxyDispatcher(opts.proxyUrl);
        const res = await fetchImpl(OR_FRONT_URL, init);
        if (!res.ok) throw new Error(`or-front download failed (${res.status})`);
        const entries = parseOrFront(JSON.parse(await readBodyLimited(res, OR_FRONT_MAX_BYTES)));
        if (!entries.length) throw new Error("empty or-front payload");
        cache = { at: Date.now(), entries };
        try {
          await fs.promises.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
          await fs.promises.writeFile(cachePath, JSON.stringify({ fetched: cache.at, data: entries }), { encoding: "utf-8", mode: 0o600 });
        } catch {  }
        return entries;
      } catch {
        return cache?.entries;
      } finally {
        inflight = undefined;
      }
    })();
  }
  return inflight;
}