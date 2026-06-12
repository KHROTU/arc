import { useEffect, useState } from "react";
import { Plus, Trash2, Plug, FileText, SlidersHorizontal, Cpu, KeyRound, ArrowLeft, Check } from "lucide-react";
import type { RpcClient, HostEvent } from "../rpc";
import type { ModelDescriptor, ModelTier, ProviderConfig, ProviderKind } from "@arc/host/protocol";
import { PROVIDERS } from "@arc/host/catalog";
import { useArcLogo, swapOnError } from "../hooks/useArcLogo";
type Props = { client: RpcClient; monoLogo: string; prideLogo: string; prideActive: boolean };
const TIERS: ModelTier[] = ["free", "light", "default", "heavy"];
type Tab = "models" | "providers" | "mcp" | "prompts" | "behavior";
const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: "models", label: "Models", icon: <Cpu size={15} /> },
  { value: "providers", label: "Providers", icon: <KeyRound size={15} /> },
  { value: "mcp", label: "MCP", icon: <Plug size={15} /> },
  { value: "prompts", label: "Prompts", icon: <FileText size={15} /> },
  { value: "behavior", label: "Behavior", icon: <SlidersHorizontal size={15} /> },
];
export default function SettingsView({ client, monoLogo, prideLogo, prideActive }: Props) {
  const logoUri = useArcLogo(monoLogo, prideLogo, prideActive);
  const [tab, setTab] = useState<Tab>("models");
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  useEffect(() => {
    const off = client.on((e: HostEvent) => {
      if (e.type === "model/list") setModels(e.models);
      if (e.type === "provider/list") setProviders(e.providers);
    });
    client.send({ type: "ready" });
    return off;
  }, [client]);
  return (
    <div className="arc-settings">
      <header className="arc-settings-head">
        <button className="arc-iconbtn" onClick={() => client.send({ type: "ui/openSidebar" })} title="Back to chat">
          <ArrowLeft size={16} />
        </button>
        <img className="arc-settings-mark" src={logoUri} alt="Arc" onError={swapOnError(monoLogo)} />
        <h1>Settings</h1>
        <nav className="arc-settings-tabs">
          {TABS.map((t) => (
            <button key={t.value} className={`arc-tab ${tab === t.value ? "is-active" : ""}`} onClick={() => setTab(t.value)}>
              {t.icon}<span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="arc-settings-body">
        <div className="arc-settings-inner">
          {tab === "models" && <ModelsTab client={client} providers={providers} models={models} onSwitchTab={setTab} />}
          {tab === "providers" && <ProvidersTab client={client} providers={providers} models={models} />}
          {tab === "mcp" && <McpTab client={client} />}
          {tab === "prompts" && <PromptsTab client={client} />}
          {tab === "behavior" && <BehaviorTab client={client} />}
        </div>
      </main>
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
  return <span className={`arc-tier-dot arc-tier-dot-${tier}`} title={tier} />;
}
function slugifyLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function matchCatalog(modelLabel: string): { id: string; costPer1mIn: number; costPer1mOut: number; contextWindow: number } | null {
  const slug = slugifyLabel(modelLabel);
  if (!slug) return null;
  for (const prov of PROVIDERS) {
    for (const m of prov.defaultModels ?? []) {
      if (slugifyLabel(m.label) === slug || slugifyLabel(m.id) === slug) {
        return { id: m.id, costPer1mIn: m.costPer1mIn, costPer1mOut: m.costPer1mOut, contextWindow: m.contextWindow };
      }
    }
  }
  return null;
}
function ModelsTab({ client, providers, models, onSwitchTab }: { client: RpcClient; providers: ProviderConfig[]; models: ModelDescriptor[]; onSwitchTab: (t: Tab) => void }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState<ModelTier>("default");
  const [ctx, setCtx] = useState(128_000);
  const add = () => {
    if (!label.trim()) return;
    const id = slugifyLabel(label) + "-" + Date.now().toString(36);
    const catalog = matchCatalog(label);
    const initialProviders: { id: string; kind: ProviderKind; priority: number; remoteModel?: string }[] = [];
    if (catalog) {
      for (const p of providers) {
        const spec = PROVIDERS.find((ps) => ps.kind === p.kind);
        if (spec) initialProviders.push({ id: p.id, kind: p.kind, priority: initialProviders.length, remoteModel: catalog.id });
      }
    }
    client.send({
      type: "model/add",
      model: {
        id,
        label,
        tier,
        contextWindow: catalog?.contextWindow ?? ctx,
        costPer1mIn: catalog?.costPer1mIn ?? 0,
        costPer1mOut: catalog?.costPer1mOut ?? 0,
        providers: initialProviders,
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
    const catalog = matchCatalog(model.label);
    const remoteModel = provider && catalog ? catalog.id : undefined;
    const updated: ModelDescriptor = {
      ...model,
      providers: [...model.providers, {
        id: providerId,
        kind: provider?.kind ?? "openai-compatible",
        priority: model.providers.length,
        ...(remoteModel ? { remoteModel } : {}),
      }],
    };
    client.send({ type: "model/remove", modelId: model.id });
    client.send({ type: "model/add", model: updated });
  };
  const setTierFor = (m: ModelDescriptor, t: ModelTier) => {
    client.send({ type: "model/remove", modelId: m.id });
    client.send({ type: "model/add", model: { ...m, tier: t } });
  };
  return (
    <Section
      title="Models"
      description="Each model has a tier and one or more providers. Set the remote slug per provider (e.g. deepseek-chat)."
      action={!adding && <button className="arc-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add model</button>}
    >
      {adding && (
        <div className="arc-form">
          <input className="arc-input" placeholder="Model label (e.g. Claude 3.5 Sonnet)" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="arc-form-row">
            <select className="arc-input" value={tier} onChange={(e) => setTier(e.target.value as ModelTier)}>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="arc-input" type="number" placeholder="context window" value={ctx} onChange={(e) => setCtx(Number(e.target.value))} />
          </div>
          <div className="arc-form-actions">
            <button className="arc-btn" onClick={add}><Check size={14} /> Save</button>
            <button className="arc-btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {models.length === 0 && !adding && <p className="arc-empty">No models yet.</p>}
      <ul className="arc-rows">
        {models.map((m) => {
          const available = providers.filter((p) => !m.providers.some((mp) => mp.id === p.id));
          return (
            <li key={m.id} className="arc-row">
              <div className="arc-row-main">
                <TierDot tier={m.tier} />
                <span className="arc-row-label">{m.label}</span>
                <select className="arc-input arc-input-sm" value={m.tier} onChange={(e) => setTierFor(m, e.target.value as ModelTier)}>
                  {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="arc-row-meta">{(m.contextWindow / 1000).toFixed(0)}K ctx</span>
                <span className="arc-spacer" />
                <button className="arc-iconbtn" onClick={() => client.send({ type: "model/remove", modelId: m.id })} title="Remove model"><Trash2 size={14} /></button>
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
  const spec = PROVIDERS.find((p) => p.kind === kind);
  const add = () => {
    if (!label.trim()) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
    client.send({
      type: "provider/add",
      provider: { id, kind, label, baseUrl: baseUrl || spec?.defaultBaseUrl || undefined, enabled: true },
      apiKey: apiKey || undefined,
    });
    setLabel(""); setBaseUrl(""); setApiKey(""); setAdding(false);
  };
  return (
    <Section
      title="Providers"
      description="API keys are stored in VS Code SecretStorage — never in plain text."
      action={!adding && <button className="arc-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add provider</button>}
    >
      {adding && (
        <div className="arc-form">
          <div className="arc-form-row">
            <select className="arc-input" value={kind} onChange={(e) => { setKind(e.target.value as ProviderKind); setBaseUrl(""); }}>
              {PROVIDERS.map((p) => <option key={p.kind} value={p.kind}>{p.label}</option>)}
            </select>
            <input className="arc-input" placeholder="Label (e.g. OpenAI main)" value={label} onChange={(e) => setLabel(e.target.value)} />
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
  return (
    <Section
      title="MCP servers"
      description="Model Context Protocol servers expose tools to the agent. Persisted to .arc/mcp.json."
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
      {servers.length === 0 && !adding && <p className="arc-empty">No servers running.</p>}
      <ul className="arc-rows">
        {servers.map((s) => (
          <li key={s.name} className="arc-row">
            <div className="arc-row-main">
              <Plug size={14} className="arc-row-icon" />
              <span className="arc-row-label">{s.name}</span>
              <span className="arc-row-meta">{s.transport} · {s.toolCount} tool{s.toolCount === 1 ? "" : "s"}</span>
              <span className="arc-spacer" />
              <button className="arc-iconbtn" onClick={() => client.send({ type: "mcp/removeServer", name: s.name })} title="Remove"><Trash2 size={14} /></button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
function PromptsTab({ client }: { client: RpcClient }) {
  const ROWS = [
    { name: "Global default", meta: "built into the extension", action: null as React.ReactNode },
    { name: ".arc/prompt.md", meta: "workspace prompt", action: <button className="arc-btn-ghost" onClick={() => client.send({ type: "ui/openPrompt" })}>Open</button> },
    { name: "AGENTS.md · CLAUDE.md · .arc/instructions.md", meta: "auto-loaded rules files", action: null },
    { name: ".arc/prompts/*.md", meta: "per-mode prompt overrides", action: null },
  ];
  return (
    <Section title="System prompts" description="Higher-precedence content overrides lower. Variables {{workspace}}, {{os}}, {{date}} are supported.">
      <ul className="arc-rows">
        {ROWS.map((r) => (
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
  );
}
function BehaviorTab({ client }: { client: RpcClient }) {
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [shellApproval, setShellApproval] = useState<"always" | "allowlist" | "off">("allowlist");
  const [allowlist, setAllowlist] = useState("ls,cat,grep,rg,git,pnpm,npm,node");
  const [compactionStrategy, setCompactionStrategy] = useState<"model-aware" | "fixed">("model-aware");
  const [safetyMargin, setSafetyMargin] = useState(0.15);
  useEffect(() => {
    void client.request("arc.notifications.enabled").then((v) => setNotifEnabled(v !== false));
    void client.request("arc.shell.approval").then((v) => setShellApproval((v as typeof shellApproval) ?? "allowlist"));
    void client.request("arc.shell.allowlist").then((v) => setAllowlist(Array.isArray(v) ? (v as string[]).join(",") : "ls,cat,grep,rg,git,pnpm,npm,node"));
    void client.request("arc.compaction.strategy").then((v) => setCompactionStrategy((v as typeof compactionStrategy) ?? "model-aware"));
    void client.request("arc.compaction.safetyMargin").then((v) => setSafetyMargin(typeof v === "number" ? v : 0.15));
  }, [client]);
  return (
    <Section title="Behavior" description="These mirror Arc's VS Code settings.">
      <ul className="arc-rows">
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Notifications</span>
          <span className="arc-row-meta">OS notifications on completion, handoff, and input</span>
          <span className="arc-spacer" />
          <Toggle checked={notifEnabled} onChange={setNotifEnabled} />
        </div></li>
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Shell approval</span>
          <span className="arc-spacer" />
          <select className="arc-input arc-input-sm" value={shellApproval} onChange={(e) => setShellApproval(e.target.value as typeof shellApproval)}>
            <option value="allowlist">allowlist</option>
            <option value="always">always ask</option>
            <option value="off">never ask</option>
          </select>
        </div></li>
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Allowlist</span>
          <input className="arc-input arc-input-grow" value={allowlist} onChange={(e) => setAllowlist(e.target.value)} />
        </div></li>
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Compaction</span>
          <span className="arc-spacer" />
          <select className="arc-input arc-input-sm" value={compactionStrategy} onChange={(e) => setCompactionStrategy(e.target.value as typeof compactionStrategy)}>
            <option value="model-aware">model-aware</option>
            <option value="fixed">fixed (75%)</option>
          </select>
        </div></li>
        <li className="arc-row"><div className="arc-row-main">
          <span className="arc-row-label">Safety margin</span>
          <span className="arc-row-meta">window reserved for output</span>
          <span className="arc-spacer" />
          <input className="arc-input arc-input-sm" type="number" min={0} max={0.5} step={0.05} value={safetyMargin} onChange={(e) => setSafetyMargin(Number(e.target.value))} />
        </div></li>
      </ul>
    </Section>
  );
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`arc-toggle ${checked ? "is-on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="arc-toggle-knob" />
    </button>
  );
}