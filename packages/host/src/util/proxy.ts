export function makeProxyDispatcher(proxyUrl: string): unknown {
  try {
    const { ProxyAgent } = require("undici") as { ProxyAgent: new (opts: { uri: string }) => unknown };
    return ProxyAgent ? new ProxyAgent({ uri: proxyUrl }) : undefined;
  } catch {
    return undefined;
  }
}