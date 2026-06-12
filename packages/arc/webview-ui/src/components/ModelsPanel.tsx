import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { RpcClient } from "../rpc";
import type { ModelDescriptor, ModelTier } from "@arc/host/protocol";
type Props = { client: RpcClient; models: ModelDescriptor[]; onClose: () => void };
const TIERS: ModelTier[] = ["free", "light", "default", "heavy"];
export default function ModelsPanel({ client, models, onClose }: Props) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState<ModelTier>("default");
  const [ctx, setCtx] = useState(128_000);
  const add = () => {
    if (!label.trim()) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
    client.send({
      type: "model/add",
      model: {
        id, label, tier,
        contextWindow: ctx,
        costPer1mIn: 0,
        costPer1mOut: 0,
        providers: [],
      },
    });
    setLabel(""); setAdding(false);
  };
  return (
    <div className="arc-panel">
      <div className="arc-panel-head">
        <h3>Models &amp; tiers</h3>
        <button className="arc-iconbtn" onClick={onClose} title="Close">×</button>
      </div>
      <div className="arc-panel-body">
        {models.length === 0 && <p className="arc-panel-empty">No models yet. Add one below.</p>}
        <ul className="arc-model-list">
          {models.map((m) => (
            <li key={m.id} className="arc-model-row">
              <div className="arc-model-row-info">
                <span className="arc-model-row-label">{m.label}</span>
                <span className={`arc-tier arc-tier-${m.tier}`}>{m.tier}</span>
                <span className="arc-model-row-ctx">{m.contextWindow.toLocaleString()} ctx</span>
                <span className="arc-model-row-prov">{m.providers.length} provider{m.providers.length === 1 ? "" : "s"}</span>
              </div>
              <button className="arc-iconbtn" title="Remove" onClick={() => client.send({ type: "model/remove", modelId: m.id })}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="arc-model-form">
            <input className="arc-input" placeholder="Model label (e.g. Claude Sonnet)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <select className="arc-input" value={tier} onChange={(e) => setTier(e.target.value as ModelTier)}>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="arc-input" type="number" placeholder="context window" value={ctx} onChange={(e) => setCtx(Number(e.target.value))} />
            <div className="arc-form-actions">
              <button className="arc-btn" onClick={add}>Add</button>
              <button className="arc-btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="arc-btn" onClick={() => setAdding(true)}><Plus size={14} /> Add model</button>
        )}
      </div>
    </div>
  );
}