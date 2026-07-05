import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Trash2, Plug, Braces, Cpu, KeyRound, X, Check, Info, ListChecks, Play, ShieldCheck, RefreshCw, CircleDot, AlertTriangle, Layers, Pencil } from "lucide-react";
import type { RpcClient, HostEvent } from "../rpc";
import type { ModelDescriptor, ModelTier, ProviderConfig, ProviderKind } from "@arc/host/protocol";
import { PROVIDERS } from "@arc/host/catalog";
type Props = { client: RpcClient; onClose: () => void; models: ModelDescriptor[]; providers: ProviderConfig[]; monoLogoText: string; version: string };
const TIERS: ModelTier[] = ["heavy", "default", "light", "free"];
const TIER_ORDER: Record<ModelTier, number> = { heavy: 0, default: 1, light: 2, free: 3 };
type Tab = "models" | "providers" | "mcp" | "general" | "search" | "customize" | "modes";
const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: "models", label: "Models", icon: <Cpu size={15} /> },
  { value: "providers", label: "Providers", icon: <KeyRound size={15} /> },
  { value: "mcp", label: "MCP", icon: <Plug size={15} /> },
  { value: "general", label: "General", icon: <Braces size={15} /> },
  { value: "search", label: "Search", icon: <Play size={15} /> },
  { value: "modes", label: "Modes", icon: <Layers size={15} /> },
  { value: "customize", label: "Customize", icon: <ListChecks size={15} /> },
];
export default function SettingsModal({ client, onClose, models, providers, monoLogoText, version }: Props) {
  const [tab, setTab] = useState<Tab>("models");
  const logoTextUri = monoLogoText;
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const setRef = useCallback((value: string) => (el: HTMLButtonElement | null) => {
    if (el) tabRefs.current.set(value, el);
    else tabRefs.current.delete(value);
  }, []);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const el = tabRefs.current.get(tab);
      if (!el) return;
      const navRect = nav.getBoundingClientRect();
      const tabRect = el.getBoundingClientRect();
      setIndicator({ left: tabRect.left - navRect.left, width: tabRect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [tab]);
  return (
    <div className="arc-modal-overlay" onClick={onClose}>
      <div className="arc-modal" onClick={(e) => e.stopPropagation()}>
        <header className="arc-modal-head">
          <h2>Settings</h2>
          <nav ref={navRef} className="arc-settings-tabs">
            {TABS.map((t) => (
              <button key={t.value} ref={setRef(t.value)} className={`arc-tab ${tab === t.value ? "is-active" : ""}`} onClick={() => setTab(t.value)}>
                {t.icon}<span>{t.label}</span>
              </button>
            ))}
            {indicator.width > 0 && <div className="arc-tab-indicator" style={{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }} />}
          </nav>
          <button className="arc-iconbtn" onClick={onClose} title="Close"><X size={16} /></button>
        </header>
        <main className="arc-modal-body">
          <div className="arc-settings-inner" key={tab}>
            {tab === "models" && <ModelsTab client={client} providers={providers} models={models} onSwitchTab={setTab} />}
            {tab === "providers" && <ProvidersTab client={client} providers={providers} models={models} />}
            {tab === "mcp" && <McpTab client={client} />}
            {tab === "general" && <GeneralTab client={client} />}
            {tab === "search" && <SearchTab client={client} />}
            {tab === "modes" && <ModesTab client={client} models={models} />}
            {tab === "customize" && <CustomTab client={client} />}
            <AboutSection logoTextUri={logoTextUri} version={version} />
          </div>
        </main>
      </div>
    </div>
  );
}
function Section({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="arc-section">
      <div className="arc-section-head">
        <div>
          <h2>{title}</h2>
          {description && <p className="arc-section-desc">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function TierDot({ tier }: { tier: ModelTier }) {
  return <span className={`arc-tier-dot arc-tier-${tier}`} />;
}
function ImageProcessingSection({ client }: { client: RpcClient }) {
  const [describer, setDescriber] = useState<string>("none");
  const [customDescriber, setCustomDescriber] = useState<string>("");
  useEffect(() => {
    void client.request("arc.image.describeModel").then((v) => {
      const val = typeof v === "string" ? v : "none";
      const known = ["none", "minicpm-v:1b", "ministral-3:8b-cloud", "gemma4:31b-cloud"];
      if (known.includes(val)) { setDescriber(val); setCustomDescriber(""); }
      else { setDescriber("custom"); setCustomDescriber(val); }
    });
  }, [client]);
  const models = [
    { value: "none", label: "none" },
    { value: "minicpm-v:1b", label: "minicpm-v:1b" },
    { value: "ministral-3:8b-cloud", label: "ministral-3:8b-cloud" },
    { value: "gemma4:31b-cloud", label: "gemma4:31b-cloud" },
    { value: "custom", label: "custom…" },
  ];
  return (
    <ul className="arc-rows">
      <li className="arc-row"><div className="arc-row-main">
        <span className="arc-row-label">Describe images with</span>
        <span className="arc-row-meta">model used to describe images for non-VL models</span>
        <span className="arc-spacer" />
        <select className="arc-input arc-input-sm" value={describer} onChange={(e) => { const v = e.target.value; setDescriber(v); if (v !== "custom") { client.send({ type: "config/set", key: "arc.image.describeModel", value: v }); setCustomDescriber(""); } }}>
          {models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div></li>
      {describer === "custom" && (
        <li className="arc-row"><div className="arc-row-main">
          <input className="arc-input arc-input-grow" placeholder="model slug (e.g. llama3.2-vision:11b)" value={customDescriber} onChange={(e) => setCustomDescriber(e.target.value)} onBlur={() => { if (customDescriber.trim()) client.send({ type: "config/set", key: "arc.image.describeModel", value: customDescriber.trim() }); }} />
        </div></li>
      )}
    </ul>
  );
}
function ModelMultimodalCheckbox({ modelId, client }: { modelId: string; client: RpcClient }) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    void client.request("arc.model.multimodalIds").then((v) => {
      const ids = Array.isArray(v) ? v as string[] : [];
      setChecked(ids.includes(modelId));
    });
  }, [client, modelId]);
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => {
        const v = e.currentTarget.checked;
        setChecked(v);
        client.send({ type: "config/set", key: "arc.model.multimodal.toggle", value: { modelId, enabled: v } });
      }}
    />
  );
}
function ModelsTab({ client, providers, models, onSwitchTab }: { client: RpcClient; providers: ProviderConfig[]; models: ModelDescriptor[]; onSwitchTab: (t: Tab) => void }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState<ModelTier>("default");
  const [ctx, setCtx] = useState(0);
  const [maxOut, setMaxOut] = useState(0);
  const [costIn, setCostIn] = useState<number | undefined>(undefined);
  const [costOut, setCostOut] = useState<number | undefined>(undefined);
  const add = () => {
    if (!label.trim()) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
    client.send({
      type: "model/add",
      model: {
        id,
        label,
        tier,
        contextWindow: ctx,
        maxOutputTokens: maxOut,
        costPer1mIn: costIn ?? 0,
        costPer1mOut: costOut ?? 0,
        providers: [],
      },
    });
    setLabel(""); setAdding(false);
  };
  const bind = (model: ModelDescriptor, providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    const has = model.providers.some((p) => p.id === providerId);
    if (has) {
      const updated: ModelDescriptor = { ...model, providers: model.providers.filter((p) => p.id !== providerId) };
      client.send({ type: "model/remove", modelId: model.id });
      client.send({ type: "model/add", model: updated });
      return;
    }
    const updated: ModelDescriptor = {
      ...model,
      providers: [...model.providers, {
        id: providerId,
        kind: provider?.kind ?? "openai-compatible",
        priority: model.providers.length,
      }],
    };
    client.send({ type: "model/remove", modelId: model.id });
    client.send({ type: "model/add", model: updated });
  };
  return (
    <Section
      title="Models"
      description="Each model has a tier and one or more providers. Set the remote slug per provider."
      action={!adding && <button className="arc-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add model</button>}
    >
      {adding && (
        <div className="arc-form">
            <input className="arc-input" placeholder="model label" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="arc-form-row">
            <select className="arc-input" value={tier} onChange={(e) => setTier(e.target.value as ModelTier)}>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="arc-input" type="number" placeholder="context window" value={ctx || ""} onChange={(e) => setCtx(Number(e.target.value))} />
          </div>
          <div className="arc-form-row">
            <input className="arc-input" type="number" placeholder="max output tokens" value={maxOut || ""} onChange={(e) => setMaxOut(Number(e.target.value))} />
            <input className="arc-input" type="number" step="0.0001" placeholder="$/1M input" value={costIn ?? ""} onChange={(e) => setCostIn(e.target.value === "" ? undefined : Number(e.target.value))} />
            <input className="arc-input" type="number" step="0.0001" placeholder="$/1M output" value={costOut ?? ""} onChange={(e) => setCostOut(e.target.value === "" ? undefined : Number(e.target.value))} />
          </div>
          <div className="arc-form-actions">
            <button className="arc-btn" onClick={add}><Check size={14} /> Save</button>
            <button className="arc-btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {models.length === 0 && !adding && <p className="arc-empty">No models yet.</p>}
      <ul className="arc-rows">
        {[...models].sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99)).map((m) => {
          const available = providers.filter((p) => !m.providers.some((mp) => mp.id === p.id));
          return (
            <li key={m.id} className="arc-row">
              <div className="arc-row-main">
                <TierDot tier={m.tier} />
                <span className="arc-row-label">{m.label}</span>
                <select className="arc-input arc-input-sm" value={m.tier} onChange={(e) => { client.send({ type: "model/remove", modelId: m.id }); client.send({ type: "model/add", model: { ...m, tier: e.target.value as ModelTier } }); }}>
                  {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="arc-spacer" />
                <button className="arc-iconbtn" onClick={() => client.send({ type: "model/remove", modelId: m.id })} title="Remove model"><Trash2 size={14} /></button>
              </div>
              <div className="arc-row-sub" key={`edit-${m.id}-${m.contextWindow}-${m.maxOutputTokens ?? 0}-${m.costPer1mIn}-${m.costPer1mOut}`}>
                <label className="arc-check" style={{ marginRight: 8 }}>
                  <ModelMultimodalCheckbox modelId={m.id} client={client} />
                  <span style={{ fontSize: 12 }}>multimodal</span>
                </label>
                <input className="arc-input arc-input-sm" type="number" placeholder="context window" defaultValue={m.contextWindow || ""} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== m.contextWindow) { client.send({ type: "model/remove", modelId: m.id }); client.send({ type: "model/add", model: { ...m, contextWindow: v } }); } }} onKeyDown={(e) => e.stopPropagation()} />
                <input className="arc-input arc-input-sm" type="number" placeholder="max output tokens" defaultValue={m.maxOutputTokens ?? ""} onBlur={(e) => { const v = Number(e.target.value) || undefined; if (v !== (m.maxOutputTokens ?? undefined)) { client.send({ type: "model/remove", modelId: m.id }); client.send({ type: "model/add", model: { ...m, maxOutputTokens: v } }); } }} onKeyDown={(e) => e.stopPropagation()} />
                <input className="arc-input arc-input-sm" type="number" step="0.0001" placeholder="$/1M in" defaultValue={m.costPer1mIn ?? ""} onBlur={(e) => { const v = Number(e.target.value); if (v !== m.costPer1mIn) { client.send({ type: "model/remove", modelId: m.id }); client.send({ type: "model/add", model: { ...m, costPer1mIn: v } }); } }} onKeyDown={(e) => e.stopPropagation()} />
                <input className="arc-input arc-input-sm" type="number" step="0.0001" placeholder="$/1M out" defaultValue={m.costPer1mOut ?? ""} onBlur={(e) => { const v = Number(e.target.value); if (v !== m.costPer1mOut) { client.send({ type: "model/remove", modelId: m.id }); client.send({ type: "model/add", model: { ...m, costPer1mOut: v } }); } }} onKeyDown={(e) => e.stopPropagation()} />
              </div>
              <ul className="arc-binds">
                {m.providers.map((p) => {
                  const prov = providers.find((x) => x.id === p.id);
                  return (
                    <li key={p.id} className="arc-bind">
                      <span className="arc-bind-name">{prov?.label ?? p.id}</span>
                      <span className="arc-bind-kind">{prov?.kind ?? p.kind}</span>
                      <input
                        className="arc-input arc-input-sm arc-bind-slug"
                        placeholder="remote slug (e.g. gpt-4o)"
                        value={p.remoteModel ?? ""}
                        onChange={(e) => client.send({ type: "model/bindUpdate", modelId: m.id, providerId: p.id, remoteModel: e.target.value.trim() || undefined })}
                      />
                      <button className="arc-iconbtn" onClick={() => bind(m, p.id)} title="Unbind"><Trash2 size={12} /></button>
                    </li>
                  );
                })}
                <li className="arc-bind arc-bind-add">
                  {providers.length === 0 ? (
                    <button className="arc-link" onClick={() => onSwitchTab("providers")}>Add a provider first →</button>
                  ) : available.length === 0 ? (
                    <span className="arc-bind-hint">all providers bound</span>
                  ) : (
                    <select className="arc-input arc-input-sm" value="" onChange={(e) => e.target.value && bind(m, e.target.value)}>
                      <option value="">+ bind provider…</option>
                      {available.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.kind})</option>)}
                    </select>
                  )}
                </li>
              </ul>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
function ProvidersTab({ client, providers, models }: { client: RpcClient; providers: ProviderConfig[]; models: ModelDescriptor[] }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const spec = PROVIDERS.find((p) => p.kind === kind);
  const add = () => {
    if (!label.trim()) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
    client.send({
      type: "provider/add",
      provider: { id, kind, label, baseUrl: baseUrl || spec?.defaultBaseUrl || undefined, enabled: true },
      apiKey: apiKey || undefined,
    });
    setLabel(""); setBaseUrl(""); setApiKey(""); setProviderSearch(""); setAdding(false);
  };
  const filteredProviders = providerSearch.length > 0
    ? PROVIDERS.filter((p) => fuzzyMatch(providerSearch, p.label) || fuzzyMatch(providerSearch, p.kind) || p.tags.some((t) => fuzzyMatch(providerSearch, t)))
    : PROVIDERS;
  return (
    <Section
      title="Providers"
      description="API keys are stored in SecretStorage, and we can't afford servers to steal your keys."
      action={!adding && <button className="arc-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add provider</button>}
    >
      {adding && (
        <div className="arc-form">
          <div className="arc-form-row">
            <div style={{ position: "relative", minWidth: 220 }}>
              <input className="arc-input" placeholder="Search providers…" value={providerSearch} onChange={(e) => setProviderSearch(e.target.value)} autoFocus style={{ width: "100%" }} />
              {providerSearch && filteredProviders.length > 0 && (
                <ul style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, maxHeight: 200, overflowY: "auto", background: "var(--vscode-dropdown-background, var(--vscode-input-background, #2d2d2d))", border: "1px solid var(--vscode-input-border, var(--arc-line))", borderRadius: 6, marginTop: 2, padding: "4px 0", listStyle: "none", margin: "2px 0 0 0" }}>
                  {filteredProviders.slice(0, 30).map((p) => (
                    <li key={p.kind} role="option" className="arc-provider-opt"
                      onClick={() => { setKind(p.kind); setLabel(p.label); setBaseUrl(""); setProviderSearch(""); }}>{p.label}</li>
                  ))}
                </ul>
              )}
            </div>
            <input className="arc-input" placeholder={spec?.label ?? "Label"} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <input className="arc-input" placeholder={spec?.defaultBaseUrl || "https://…"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <input className="arc-input" type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="arc-form-actions">
            <button className="arc-btn" onClick={add}><Check size={14} /> Save</button>
            <button className="arc-btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {providers.length === 0 && !adding && <p className="arc-empty">No providers yet.</p>}
      <ul className="arc-rows">
        {providers.map((p) => {
          const bound = models.filter((m) => m.providers.some((mp) => mp.id === p.id));
          return (
            <li key={p.id} className="arc-row">
              <div className="arc-row-main">
                <span className="arc-row-label">{p.label}</span>
                <span className="arc-row-meta">{p.kind}</span>
                {p.baseUrl && <code className="arc-row-code">{p.baseUrl}</code>}
                <span className="arc-spacer" />
                <Toggle checked={p.enabled} onChange={(enabled) => client.send({ type: "provider/toggle", providerId: p.id, enabled })} />
                <button className="arc-iconbtn" onClick={() => client.send({ type: "provider/remove", providerId: p.id })} title="Remove"><Trash2 size={14} /></button>
              </div>
              {bound.length > 0 && <div className="arc-row-sub">bound to {bound.map((m) => m.label).join(", ")}</div>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
function McpTab({ client }: { client: RpcClient }) {
  const [servers, setServers] = useState<{ name: string; enabled: boolean; transport: "stdio" | "http"; toolCount: number }[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [transportType, setTransportType] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("npx -y @modelcontextprotocol/server-fetch");
  const [url, setUrl] = useState("https://example.com/mcp");
  useEffect(() => {
    const off = client.on((e: HostEvent) => { if (e.type === "mcp/list") setServers(e.servers); });
    client.send({ type: "mcp/list" });
    return off;
  }, [client]);
  const add = () => {
    if (!name.trim()) return;
    if (transportType === "stdio") {
      const parts = command.trim().split(/\s+/);
      client.send({ type: "mcp/addServer", name, transport: { type: "stdio", command: parts[0], args: parts.slice(1) } });
    } else {
      client.send({ type: "mcp/addServer", name, transport: { type: "http", url } });
    }
    setName(""); setAdding(false);
  };
  const toggle = (serverName: string, enabled: boolean) => {
    client.send({ type: "mcp/toggleServer", name: serverName, enabled });
  };
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const testCall = (serverName: string) => {
    setTesting(serverName); setTestResults((prev) => ({ ...prev, [serverName]: "Calling…" }));
    client.send({ type: "mcp/testCall", server: serverName, tool: "listResources" });
  };
  const [debugMsgs, setDebugMsgs] = useState<{ server: string; dir: string; msg: string }[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  useEffect(() => {
    const off = client.on((e: any) => {
      if (e.type === "mcp/testResult") { setTestResults((prev) => ({ ...prev, [e.server ?? testing]: e.output ?? "(no response)" })); setTesting(null); }
      if (e.type === "mcp/traffic") { setDebugMsgs((prev) => [...prev.slice(-49), { server: e.server, dir: e.dir, msg: e.msg }]); }
    });
    return off;
  }, [client]);
  return (
    <>
      <Section
        title="Configured servers"
        description="Model Context Protocol servers expose tools to the agent. Persisted to ~/.arc/mcp.json."
        action={!adding && <button className="arc-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add server</button>}
      >
        {adding && (
          <div className="arc-form">
            <div className="arc-form-row">
              <input className="arc-input" placeholder="Server name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
              <select className="arc-input" value={transportType} onChange={(e) => setTransportType(e.target.value as "stdio" | "http")}>
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </div>
            {transportType === "stdio" ? (
              <input className="arc-input" placeholder="command + args" value={command} onChange={(e) => setCommand(e.target.value)} />
            ) : (
              <input className="arc-input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            )}
            <div className="arc-form-actions">
              <button className="arc-btn" onClick={add}><Check size={14} /> Save</button>
              <button className="arc-btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}
        {servers.length === 0 && !adding && <p className="arc-empty">No servers configured.</p>}
        <ul className="arc-rows">
          {servers.map((s) => (
            <li key={s.name} className="arc-row">
              <div className="arc-row-main">
                <Plug size={14} className="arc-row-icon" />
                <span className="arc-row-label">{s.name}</span>
                <span className="arc-row-meta">{s.transport} · {s.toolCount} tool{s.toolCount === 1 ? "" : "s"}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title={s.enabled ? (s.toolCount > 0 ? "Connected" : "Connecting…") : "Disabled"}>
                  {s.enabled ? (s.toolCount > 0 ? <CircleDot size={12} style={{ color: "var(--arc-ok)" }} /> : <RefreshCw size={11} style={{ color: "var(--vscode-descriptionForeground)", opacity: 0.6, animation: "arc-spin 1.4s linear infinite" }} />) : <AlertTriangle size={12} style={{ color: "var(--arc-err)" }} />}
                  <span style={{ fontSize: 10, color: "var(--vscode-descriptionForeground)" }}>{s.enabled ? (s.toolCount > 0 ? "OK" : "…") : "OFF"}</span>
                </span>
                <span className="arc-spacer" />
                <button className="arc-chip" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => testCall(s.name)} disabled={!s.enabled || testing === s.name}><Play size={11} /> Test</button>
                <Toggle checked={s.enabled} onChange={(enabled) => toggle(s.name, enabled)} />
                <button className="arc-iconbtn" onClick={() => client.send({ type: "mcp/removeServer", name: s.name })} title="Remove"><Trash2 size={14} /></button>
              </div>
              {testing === s.name && <p className="arc-empty">Testing {s.name}…</p>}
              {testResults[s.name] && <div className="arc-mcp-test-output">{testResults[s.name]}</div>}
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button className="arc-chip" onClick={() => setShowDebug(!showDebug)} style={{ padding: "3px 8px", fontSize: 11 }}>
            <ShieldCheck size={12} /> {showDebug ? "Hide" : "Show"} traffic
          </button>
          {showDebug && <button className="arc-iconbtn" onClick={() => setDebugMsgs([])} title="Clear"><RefreshCw size={12} /></button>}
        </div>
        {showDebug && debugMsgs.length > 0 && (
          <div className="arc-mcp-debug">
            {debugMsgs.map((d, i) => (
              <div key={i} className="arc-mcp-debug-entry">
                <span className="arc-mcp-debug-server">{d.server}</span>
                <span className="arc-mcp-debug-dir">{d.dir === "out" ? "→" : "←"}</span>
                <span className="arc-mcp-debug-msg">{d.msg}</span>
              </div>
            ))}
          </div>
        )}
        {showDebug && debugMsgs.length === 0 && <p className="arc-empty">No traffic yet. Monitoring…</p>}
      </Section>
      <McpMarketplace client={client} existingServers={servers} />
    </>
  );
}
function McpMarketplace({ client, existingServers }: { client: RpcClient; existingServers: { name: string }[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const installed = new Set(existingServers.map((s) => s.name));
  useEffect(() => {
    const off = client.on((e: any) => {
      if (e.type === "mcp/marketplaceResults") {
        setLoading(false);
        if (e.error) setError(e.error);
        else { setResults(e.results ?? []); setError(null); }
      }
    });
    client.send({ type: "mcp/marketplaceSearch", query: "" });
    return off;
  }, [client]);
  const search = () => {
    setLoading(true); setError(null);
    client.send({ type: "mcp/marketplaceSearch", query: query.trim() });
  };
  const install = (item: any) => {
    const srv = item.server ?? item;
    const name = srv.name;
    setInstalling(name);
    const pkg = srv.packages?.[0];
    const remote = srv.remotes?.[0];
    if (remote?.type === "http" && remote.url) {
      client.send({ type: "mcp/addServer", name, transport: { type: "http", url: remote.url } });
    } else if (pkg) {
      const cmd = pkg.registryType === "pypi" ? `uvx ${pkg.identifier}` : `npx -y ${pkg.identifier}`;
      const parts = cmd.trim().split(/\s+/);
      client.send({ type: "mcp/addServer", name, transport: { type: "stdio", command: parts[0], args: parts.slice(1) } });
    }
    setTimeout(() => setInstalling(null), 3000);
  };
  const remoteType = (item: any) => {
    const r = item.server?.remotes?.[0];
    if (r?.type === "http") return "HTTP";
    return "stdio";
  };
  return (
    <Section title="Marketplace" description="Browse the official MCP registry for ready-to-install servers.">
      <div style={{ marginBottom: 12 }}>
        <input className="arc-input arc-input-grow" placeholder="Filter by name…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
      </div>
      {loading && <p className="arc-empty">Loading marketplace…</p>}
      {error && <p className="arc-empty" style={{ color: "var(--arc-err)" }}>{error}</p>}
      {!loading && !error && results.length === 0 && <p className="arc-empty">No results.</p>}
      <div className="arc-mcp-cards">
        {results.map((item) => {
          const srv = item.server ?? item;
          const isInstalled = installed.has(srv.name);
          const isInstalling = installing === srv.name;
          const pkg = srv.packages?.[0];
          return (
            <div key={srv.name} className={`arc-mcp-card ${isInstalled ? "is-installed" : ""}`}>
              <div className="arc-mcp-card-head">
                <span className="arc-mcp-card-name">{srv.title || srv.name}</span>
              </div>
              <p className="arc-mcp-card-desc">{srv.description || ""}</p>
              <div className="arc-mcp-card-foot">
                {pkg ? <code>{pkg.identifier}</code> : <span>{remoteType(item)}</span>}
                {isInstalled ? (
                  <span style={{ color: "var(--arc-ok)", fontSize: 11, fontWeight: 500 }}>installed</span>
                ) : (
                  <button className="arc-btn" style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => install(item)} disabled={isInstalling}>
                    {isInstalling ? "…" : "Install"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
function GeneralTab({ client }: { client: RpcClient }) {
  const [compactionStrategy, setCompactionStrategy] = useState<"model-aware" | "fixed">("model-aware");
  const [safetyMargin, setSafetyMargin] = useState(0.15);
  const [titleGenMethod, setTitleGenMethod] = useState<"first-words" | "ollama">("first-words");
  const [spoofRpc, setSpoofRpc] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyProviderUrl, setProxyProviderUrl] = useState("");
  const [proxyWebUrl, setProxyWebUrl] = useState("");
  const [proxyShellUrl, setProxyShellUrl] = useState("");
  const [verifyMode, setVerifyMode] = useState<"none" | "default" | "custom">("default");
  const [verifyMaxRetries, setVerifyMaxRetries] = useState(3);
  useEffect(() => {
    void client.request("arc.compaction.strategy").then((v) => setCompactionStrategy((v as typeof compactionStrategy) ?? "model-aware"));
    void client.request("arc.compaction.safetyMargin").then((v) => setSafetyMargin(typeof v === "number" ? v : 0.15));
    void client.request("arc.titleGeneration.method").then((v) => setTitleGenMethod(v === "ollama" ? "ollama" : "first-words"));
    void client.request("arc.discord.spoofRpc").then((v) => setSpoofRpc(v === true));
    void client.request("arc.proxy.url").then((v) => setProxyUrl(typeof v === "string" ? v : ""));
    void client.request("arc.proxy.providerUrl").then((v) => setProxyProviderUrl(typeof v === "string" ? v : ""));
    void client.request("arc.proxy.webUrl").then((v) => setProxyWebUrl(typeof v === "string" ? v : ""));
    void client.request("arc.proxy.shellUrl").then((v) => setProxyShellUrl(typeof v === "string" ? v : ""));
    void client.request("arc.verify.mode").then((v) => setVerifyMode(v === "none" || v === "custom" ? v : "default"));
    void client.request("arc.verify.customMaxRetries").then((v) => setVerifyMaxRetries(typeof v === "number" ? v : 3));
  }, [client]);
  return (
    <>
      <Section title="Verification" description="Runs commands from .arc/verify.toml after file edits and feeds failures back to the agent to fix.">
        <ul className="arc-rows">
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Retry strategy</span>
            <span className="arc-row-meta">how many times to retry after a failed verification</span>
            <span className="arc-spacer" />
            <select className="arc-input arc-input-sm" value={verifyMode} onChange={(e) => { const v = e.target.value as typeof verifyMode; setVerifyMode(v); client.send({ type: "config/set", key: "arc.verify.mode", value: v }); }}>
              <option value="none">off</option>
              <option value="default">default</option>
              <option value="custom">custom...</option>
            </select>
          </div></li>
          {verifyMode === "custom" && (
            <li className="arc-row"><div className="arc-row-main">
              <span className="arc-row-label">Max retries</span>
              <span className="arc-spacer" />
              <input className="arc-input arc-input-sm" type="number" min={0} step={1} value={verifyMaxRetries} onChange={(e) => setVerifyMaxRetries(Number(e.target.value))} onBlur={() => client.send({ type: "config/set", key: "arc.verify.customMaxRetries", value: verifyMaxRetries })} />
            </div></li>
          )}
        </ul>
      </Section>
      <Section title="Compaction" description="Controls when and how conversation context is summarized.">
        <ul className="arc-rows">
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Strategy</span>
            <span className="arc-spacer" />
            <select className="arc-input arc-input-sm" value={compactionStrategy} onChange={(e) => { const v = e.target.value as typeof compactionStrategy; setCompactionStrategy(v); client.send({ type: "config/set", key: "arc.compaction.strategy", value: v }); }}>
              <option value="model-aware">model-aware</option>
              <option value="fixed">fixed (75%)</option>
            </select>
          </div></li>
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Safety margin</span>
            <span className="arc-row-meta">window reserved for model output</span>
            <span className="arc-spacer" />
            <input className="arc-input arc-input-sm" type="number" min={0} max={0.5} step={0.05} value={safetyMargin} onChange={(e) => setSafetyMargin(Number(e.target.value))} onBlur={() => client.send({ type: "config/set", key: "arc.compaction.safetyMargin", value: safetyMargin })} />
          </div></li>
        </ul>
      </Section>
      <Section title="Proxy" description="Optional HTTP/HTTPS proxy URLs. Category-specific settings override the fallback (URL).">
        <ul className="arc-rows">
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">URL</span>
            <span className="arc-row-meta">Fallback for all categories</span>
            <span className="arc-spacer" />
            <input className="arc-input arc-input-sm" type="text" placeholder="http://proxy:8080" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} onBlur={() => client.send({ type: "config/set", key: "arc.proxy.url", value: proxyUrl.trim() })} style={{ width: 280 }} />
          </div></li>
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Provider</span>
            <span className="arc-row-meta">Model provider API calls (OpenAI, Anthropic, Ollama, etc.)</span>
            <span className="arc-spacer" />
            <input className="arc-input arc-input-sm" type="text" placeholder="http://proxy:8080" value={proxyProviderUrl} onChange={(e) => setProxyProviderUrl(e.target.value)} onBlur={() => client.send({ type: "config/set", key: "arc.proxy.providerUrl", value: proxyProviderUrl.trim() })} style={{ width: 280 }} />
          </div></li>
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Web</span>
            <span className="arc-row-meta">web.fetch and web.search tools</span>
            <span className="arc-spacer" />
            <input className="arc-input arc-input-sm" type="text" placeholder="http://proxy:8080" value={proxyWebUrl} onChange={(e) => setProxyWebUrl(e.target.value)} onBlur={() => client.send({ type: "config/set", key: "arc.proxy.webUrl", value: proxyWebUrl.trim() })} style={{ width: 280 }} />
          </div></li>
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Shell</span>
            <span className="arc-row-meta">Sets HTTP_PROXY / HTTPS_PROXY env vars on shell commands</span>
            <span className="arc-spacer" />
            <input className="arc-input arc-input-sm" type="text" placeholder="http://proxy:8080" value={proxyShellUrl} onChange={(e) => setProxyShellUrl(e.target.value)} onBlur={() => client.send({ type: "config/set", key: "arc.proxy.shellUrl", value: proxyShellUrl.trim() })} style={{ width: 280 }} />
          </div></li>
        </ul>
      </Section>
      <Section title="Titles" description="How new chat titles are generated.">
        <ul className="arc-rows">
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Method</span>
            <span className="arc-spacer" />
            <select className="arc-input arc-input-sm" value={titleGenMethod} onChange={(e) => { const v = e.target.value as typeof titleGenMethod; setTitleGenMethod(v); client.send({ type: "config/set", key: "arc.titleGeneration.method", value: v }); }}>
              <option value="first-words">first 40 chars</option>
              <option value="ollama">gemma3:1b</option>
            </select>
          </div></li>
        </ul>
      </Section>
      <Section title="Discord" description="Show the file the agent is editing as your Discord rich presence.">
        <ul className="arc-rows">
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Spoof RPC</span>
            <span className="arc-row-meta">Report agent file edits to Discord extensions</span>
            <span className="arc-spacer" />
            <Toggle checked={spoofRpc} onChange={(v) => { setSpoofRpc(v); client.send({ type: "config/set", key: "arc.discord.spoofRpc", value: v }); }} />
          </div></li>
        </ul>
      </Section>
      <Section title="Images" description="How attached images are handled when the active model is not multimodal.">
        <ImageProcessingSection client={client} />
      </Section>
    </>
  );
}
function SearchTab({ client }: { client: RpcClient }) {
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [searchBackend, setSearchBackend] = useState<"hash-based" | "semantic">("hash-based");
  const [searchModelTier, setSearchModelTier] = useState<"low" | "mid" | "high">("low");
  const [searchChunks, setSearchChunks] = useState(0);
  const [autoReindex, setAutoReindex] = useState<"off" | "hourly" | "daily">("off");
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState<{ scanned: number; indexed: number; chunks: number; errors: number }>({ scanned: 0, indexed: 0, chunks: 0, errors: 0 });
  useEffect(() => {
    void client.request("arc.search.enabled").then((v) => setSearchEnabled(v !== false));
    void client.request("arc.search.backend").then((v) => setSearchBackend((v === "semantic" ? "semantic" : "hash-based")));
    void client.request("arc.search.modelTier").then((v) => {
      if (v === "mid") setSearchModelTier("mid");
      else if (v === "high") setSearchModelTier("high");
      else setSearchModelTier("low");
    });
    void client.request("arc.search.chunkCount").then((v) => setSearchChunks(typeof v === "number" ? v : 0));
    void client.request("arc.search.autoReindex").then((v) => setAutoReindex(v === "hourly" || v === "daily" ? v : "off"));
    const off = client.on((e: any) => {
      if (e.type === "search/indexProgress") {
        setIndexing(true);
        setProgress({ scanned: e.filesScanned, indexed: e.filesIndexed, chunks: e.chunksEmbedded, errors: e.errors });
        setSearchChunks(e.chunksEmbedded);
        if (e.filesScanned === e.filesIndexed) setIndexing(false);
      }
    });
    return off;
  }, [client]);
  const pct = progress.scanned > 0 ? (progress.indexed / progress.scanned) * 100 : 0;
  return (
    <Section title="Semantic search" description="Indexes the workspace with an embedding model for natural-language queries.">
      <ul className="arc-rows">
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Enable</span>
          <span className="arc-row-meta">Index the workspace on activation and keep it in sync</span>
          <span className="arc-spacer" />
          <Toggle checked={searchEnabled} onChange={(v) => { setSearchEnabled(v); client.send({ type: "config/set", key: "arc.search.enabled", value: v }); }} />
        </div></li>
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Backend</span>
          <span className="arc-spacer" />
          <select className="arc-input arc-input-sm" value={searchBackend} onChange={(e) => { const v = e.target.value as typeof searchBackend; setSearchBackend(v); client.send({ type: "config/set", key: "arc.search.backend", value: v }); }}>
            <option value="hash-based">hash-based</option>
            <option value="semantic">semantic</option>
          </select>
        </div></li>
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Automatic reindexing</span>
          <span className="arc-row-meta">Periodically rebuild the full index, in addition to live file watching</span>
          <span className="arc-spacer" />
          <select className="arc-input arc-input-sm" value={autoReindex} onChange={(e) => { const v = e.target.value as typeof autoReindex; setAutoReindex(v); client.send({ type: "config/set", key: "arc.search.autoReindex", value: v }); }}>
            <option value="off">off</option>
            <option value="hourly">hourly</option>
            <option value="daily">daily</option>
          </select>
        </div></li>
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Model tier</span>
          <span className="arc-spacer" />
          <select className="arc-input arc-input-sm" value={searchModelTier} onChange={(e) => { const v = e.target.value as typeof searchModelTier; setSearchModelTier(v); client.send({ type: "config/set", key: "arc.search.modelTier", value: v }); }}>
            <option value="low">nomic-embed-text (768d)</option>
            <option value="mid">qwen3-embedding:0.6b (1024d)</option>
            <option value="high">qwen3-embedding:8b (4096d)</option>
          </select>
        </div></li>
      </ul>
      <div className="arc-progress-wrap">
        <button className="arc-chip" onClick={() => { setIndexing(true); setProgress({ scanned: 0, indexed: 0, chunks: 0, errors: 0 }); client.send({ type: "search/reindex" }); }} disabled={indexing}>Reindex {searchChunks > 0 ? `(${searchChunks} chunks)` : ""}</button>
        {indexing && (
          <div style={{ marginTop: 8 }}>
            <div className="arc-progress-bar"><div className="arc-progress-fill" style={{ width: `${pct}%` }} /></div>
            <p className="arc-progress-text">{progress.indexed} files · {progress.chunks} chunks{progress.errors > 0 ? ` · ${progress.errors} errors` : ""}</p>
          </div>
        )}
      </div>
    </Section>
  );
}
interface CustomModeEntry { slug: string; roleDefinition: string; allowedTools: string[]; writeGlob?: string; description: string; whenToUse: string; model?: string; source: "builtin" | "workspace" | "global" }
function emptyModeEntry(): CustomModeEntry {
  return { slug: "", roleDefinition: "", allowedTools: [], writeGlob: "", description: "", whenToUse: "", model: "", source: "workspace" };
}
function ModesTab({ client, models }: { client: RpcClient; models: ModelDescriptor[] }) {
  const [modes, setModes] = useState<CustomModeEntry[]>([]);
  const [editing, setEditing] = useState<CustomModeEntry | null>(null);
  const [toolsText, setToolsText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const off = client.on((e: any) => {
      if (e.type === "mode/list") setModes(e.modes);
      if (e.type === "error" && typeof e.message === "string" && e.message.startsWith("Failed to save mode")) setError(e.message);
    });
    client.send({ type: "mode/list" });
    return off;
  }, [client]);
  const startNew = () => { setEditing(emptyModeEntry()); setToolsText(""); setError(""); };
  const startEdit = (m: CustomModeEntry) => { setEditing(m); setToolsText(m.allowedTools.join(", ")); setError(""); };
  const cancel = () => { setEditing(null); setError(""); };
  const save = () => {
    if (!editing) return;
    const allowedTools = toolsText.split(",").map((t) => t.trim()).filter(Boolean);
    if (!editing.slug.trim() || !editing.roleDefinition.trim() || !allowedTools.length) { setError("Name, prompt, and at least one tool are required."); return; }
    client.send({
      type: "mode/save",
      mode: { slug: editing.slug.trim(), roleDefinition: editing.roleDefinition, allowedTools, writeGlob: editing.writeGlob || undefined, description: editing.description, whenToUse: editing.whenToUse, model: editing.model || undefined },
      scope: "workspace",
    });
    setEditing(null);
  };
  const remove = (slug: string) => client.send({ type: "mode/delete", slug, scope: "workspace" });
  return (
    <Section title="Modes" description="Custom agent modes with their own system prompt, allowed tools, write scope, and preferred model." action={!editing && <button className="arc-btn" onClick={startNew}><Plus size={14} /> New mode</button>}>
      {!editing && (
        <ul className="arc-rows">
          {modes.map((m) => (
            <li key={m.slug} className="arc-row"><div className="arc-row-main">
              <span className="arc-row-label">{m.slug}</span>
              <span className="arc-row-meta">{m.description || m.whenToUse || "—"} · {m.source}</span>
              <span className="arc-spacer" />
              <button className="arc-iconbtn" onClick={() => startEdit(m)} title="Edit"><Pencil size={14} /></button>
              <button className="arc-iconbtn" onClick={() => remove(m.slug)} title={m.source === "builtin" ? "Reset to default" : "Delete"}><Trash2 size={14} /></button>
            </div></li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="arc-form">
          {error && <p className="arc-section-desc" style={{ color: "var(--vscode-errorForeground)" }}>{error}</p>}
          <input className="arc-input" placeholder="name (slug, e.g. reviewer)" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} />
          <textarea className="arc-input" style={{ width: "100%", resize: "vertical" }} rows={6} placeholder="prompt (system role definition)" value={editing.roleDefinition} onChange={(e) => setEditing({ ...editing, roleDefinition: e.target.value })} />
          <input className="arc-input" placeholder="tools (comma-separated, e.g. file.read, file.grep, lsp.problems)" value={toolsText} onChange={(e) => setToolsText(e.target.value)} />
          <div className="arc-form-row">
            <input className="arc-input" placeholder="write glob (optional, e.g. **/*.ts)" value={editing.writeGlob ?? ""} onChange={(e) => setEditing({ ...editing, writeGlob: e.target.value })} />
            <select className="arc-input" value={editing.model ?? ""} onChange={(e) => setEditing({ ...editing, model: e.target.value })}>
              <option value="">(use current model)</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <input className="arc-input" placeholder="description" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          <input className="arc-input" placeholder="when to use" value={editing.whenToUse} onChange={(e) => setEditing({ ...editing, whenToUse: e.target.value })} />
          <div className="arc-form-actions">
            <button className="arc-btn" onClick={save}><Check size={14} /> Save</button>
            <button className="arc-btn-ghost" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
    </Section>
  );
}
function CustomTab({ client }: { client: RpcClient }) {
  const PROMPTS = [
    { name: "Global default", meta: "built into the extension", action: null as React.ReactNode },
    { name: "~/.arc/workspaces/*/prompt.md", meta: "workspace prompt", action: <button className="arc-btn-ghost" onClick={() => client.send({ type: "ui/openPrompt" })}>Open</button> },
    { name: "AGENTS.md / CLAUDE.md · ~/.arc/workspaces/*/instructions.md", meta: "auto-loaded rules files", action: null },
    { name: "~/.arc/workspaces/*/prompts/*.md", meta: "per-mode prompt overrides", action: null },
  ];
  const [memories, setMemories] = useState<{ index: number; category: string; content: string; createdAt: string }[]>([]);
  const [memLoading, setMemLoading] = useState(true);
  const [hooks, setHooks] = useState<{ event: string; matcher: string; command: string; enabled: boolean; tools?: string[] }[]>([]);
  const [prideLogo, setPrideLogo] = useState<"always" | "june" | "never">("june");
  const [toolTree, setToolTree] = useState<"auto" | "collapsed">("auto");
  useEffect(() => {
    const offMem = client.on((e: any) => {
      if (e.type === "memory/list") { setMemories(e.memories); setMemLoading(false); }
    });
    client.send({ type: "memory/list" });
    const offHooks = client.on((e: any) => {
      if (e.type === "hooks/list") setHooks(Array.isArray(e.hooks) ? e.hooks : []);
    });
    client.send({ type: "hooks/list" });
    void client.request("arc.appearance.prideLogo").then((v) => setPrideLogo(v === "always" || v === "never" ? v as typeof prideLogo : "june"));
    void client.request("arc.appearance.toolTree").then((v) => setToolTree(v === "auto" ? "auto" : "collapsed"));
    return () => { offMem(); offHooks(); };
  }, [client]);
  return (
    <>
      <Section title="System prompts" description="Higher-precedence content overrides lower. Variables {{workspace}}, {{os}}, {{date}} are supported.">
        <ul className="arc-rows">
          {PROMPTS.map((r) => (
            <li key={r.name} className="arc-row">
              <div className="arc-row-main">
                <span className="arc-row-label">{r.name}</span>
                <span className="arc-row-meta">{r.meta}</span>
                <span className="arc-spacer" />
                {r.action}
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Appearance" description="Visual preferences for the chat interface.">
        <ul className="arc-rows">
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Pride logo</span>
            <span className="arc-row-meta">When to show the pride variant in the welcome text and sidebar</span>
            <span className="arc-spacer" />
            <select className="arc-input arc-input-sm" value={prideLogo} onChange={(e) => { const v = e.target.value as typeof prideLogo; setPrideLogo(v); client.send({ type: "config/set", key: "arc.appearance.prideLogo", value: v }); }}>
              <option value="june">june</option>
              <option value="always">always</option>
              <option value="never">never</option>
            </select>
          </div></li>
          <li className="arc-row"><div className="arc-row-main">
            <span className="arc-row-label">Tool call tree</span>
            <span className="arc-row-meta">How tool call trees expand and collapse</span>
            <span className="arc-spacer" />
            <select className="arc-input arc-input-sm" value={toolTree} onChange={(e) => { const v = e.target.value as typeof toolTree; setToolTree(v); client.send({ type: "config/set", key: "arc.appearance.toolTree", value: v }); }}>
              <option value="auto">auto</option>
              <option value="collapsed">collapsed</option>
            </select>
          </div></li>
        </ul>
      </Section>
      <Section title="Memories" description="Persistent facts, preferences, and gotchas saved across sessions.">
        {memLoading ? <p className="arc-empty">Loading…</p> : memories.length === 0 ? <p className="arc-empty">No memories stored.</p> : (
          <ul className="arc-rows">
            {memories.map((m) => (
              <li key={m.index} className="arc-row">
                <div className="arc-row-main">
                  <span className="arc-row-label">[{m.category}] {m.content}</span>
                  <span className="arc-row-meta">{m.createdAt}</span>
                  <span className="arc-spacer" />
                  <button className="arc-iconbtn" onClick={() => client.send({ type: "memory/delete", index: m.index })} title="Delete"><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Hooks" description="Custom scripts on lifecycle events. Configured in .arc/hooks.json.">
        {hooks.length === 0 && (
          <div className="arc-hook-empty">
            <p className="arc-empty">No hooks configured.</p>
            <p className="arc-hint-text">Add hooks to <code>.arc/hooks.json</code> for events like <strong>session.start</strong>, <strong>pre.tool</strong>, <strong>post.tool</strong>, or <strong>stop</strong>.</p>
          </div>
        )}
        <div className="arc-hook-panel">
          {hooks.map((h, i) => (
            <div key={i} className="arc-hook-item">
              <div className="arc-hook-item-head">
                <span className="arc-hook-item-event">{h.event}</span>
                {h.tools?.length ? <span className="arc-row-code">{h.tools.join(", ")}</span> : null}
                <span className="arc-row-meta">matcher: {h.matcher}</span>
                <span className={`arc-mcp-health-dot ${h.enabled ? "arc-mcp-health-dot-ok" : "arc-mcp-health-dot-err"}`} />
              </div>
              <div className="arc-hook-item-cmd">{h.command}</div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
function AboutSection({ logoTextUri, version }: { logoTextUri: string; version: string }) {
  return (
    <div className="arc-settings-about" style={{ marginTop: 40, padding: "20px 0", borderTop: "1px solid var(--vscode-panel-border)" }}>
      <div className="arc-about" style={{ display: "flex", flexDirection: "row", gap: "3%", alignItems: "flex-start", padding: 0 }}>
        <img className="arc-about-logo-text" src={logoTextUri} alt="Arc" style={{ width: "50%", height: "auto", flexShrink: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "clamp(2px, 0.5vw, 8px)", width: "47%" }}>
          <p className="arc-about-version" style={{ margin: 0, fontSize: "clamp(11px, 1.4vw, 16px)", fontWeight: 600 }}>v{version}</p>
          <p className="arc-about-alpha" style={{ display: "flex", gap: "clamp(4px, 0.8vw, 10px)", alignItems: "flex-start", fontSize: "clamp(10px, 1.1vw, 13px)", color: "var(--vscode-descriptionForeground)", margin: 0 }}>
            <Info size={16} style={{ flexShrink: 0, marginTop: 1, width: "clamp(12px, 1.6vw, 18px)", height: "clamp(12px, 1.6vw, 18px)" }} />
            <span>This extension is in <strong style={{ color: "var(--vscode-foreground)" }}>alpha testing</strong>. Features, APIs, and configuration formats may change without notice.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`arc-toggle ${checked ? "is-on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="arc-toggle-knob" />
    </button>
  );
}
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}