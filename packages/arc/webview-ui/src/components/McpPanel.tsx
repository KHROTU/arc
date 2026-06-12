import { useEffect, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { RpcClient, HostEvent } from "../rpc";
type Server = { name: string; enabled: boolean; transport: "stdio" | "http"; toolCount: number };
type Props = { client: RpcClient; onClose: () => void };
export default function McpPanel({ client, onClose }: Props) {
  const [servers, setServers] = useState<Server[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [transportType, setTransportType] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("npx -y @modelcontextprotocol/server-fetch");
  const [url, setUrl] = useState("https://example.com/mcp");
  useEffect(() => {
    const off = client.on((e: HostEvent) => {
      if (e.type === "mcp/list") setServers(e.servers);
    });
    client.send({ type: "mcp/list" });
    return off;
  }, [client]);
  const add = () => {
    if (!name.trim()) return;
    if (transportType === "stdio") {
      const parts = command.trim().split(/\s+/);
      client.send({
        type: "mcp/addServer",
        name,
        transport: { type: "stdio", command: parts[0], args: parts.slice(1) },
      });
    } else {
      client.send({ type: "mcp/addServer", name, transport: { type: "http", url } });
    }
    setName("");
    setAdding(false);
  };
  return (
    <div className="arc-panel">
      <div className="arc-panel-head">
        <h3>MCP servers</h3>
        <button className="arc-iconbtn" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="arc-panel-body">
        {servers.length === 0 && !adding && <p className="arc-panel-empty">No MCP servers running. Add one to expose tools to the agent.</p>}
        <ul className="arc-mcp-list">
          {servers.map((s) => (
            <li key={s.name} className="arc-mcp-row">
              <div className="arc-mcp-row-info">
                <span className="arc-mcp-row-label">{s.name}</span>
                <span className="arc-mcp-row-meta">{s.transport} · {s.toolCount} tool{s.toolCount === 1 ? "" : "s"}</span>
              </div>
              <button className="arc-iconbtn" onClick={() => client.send({ type: "mcp/removeServer", name: s.name })}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="arc-model-form">
            <input className="arc-input" placeholder="Server name (e.g. fetch)" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="arc-input" value={transportType} onChange={(e) => setTransportType(e.target.value as "stdio" | "http")}>
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
            {transportType === "stdio" ? (
              <input className="arc-input" placeholder="command + args" value={command} onChange={(e) => setCommand(e.target.value)} />
            ) : (
              <input className="arc-input" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
            )}
            <div className="arc-form-actions">
              <button className="arc-btn" onClick={add}>Add</button>
              <button className="arc-btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="arc-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add server</button>
        )}
        <p className="arc-panel-hint">Servers are persisted to <code>.arc/mcp.json</code> in your workspace.</p>
      </div>
    </div>
  );
}