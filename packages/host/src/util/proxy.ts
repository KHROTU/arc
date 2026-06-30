export function makeProxyDispatcher(proxyUrl: string): unknown {
  try {
    const undici = require("undici") as { ProxyAgent?: new (opts: { uri: string }) => unknown };
    if (!undici.ProxyAgent) return undefined;
    return new undici.ProxyAgent({ uri: proxyUrl });
  } catch {
    return undefined;
  }
}