import type { ModelDescriptor, ModelTier, ProviderConfig, ProviderRef } from "../protocol/protocol.js";
export class ModelRegistry {
  private models = new Map<string, ModelDescriptor>();
  private providers = new Map<string, ProviderConfig>();
  private currentModelId: string | undefined;
  load(input: { models: ModelDescriptor[]; providers: ProviderConfig[]; currentModelId?: string }) {
    this.models.clear();
    this.providers.clear();
    for (const m of input.models) this.models.set(m.id, m);
    for (const p of input.providers) this.providers.set(p.id, p);
    this.currentModelId = input.currentModelId;
  }
  list(): ModelDescriptor[] {
    return [...this.models.values()];
  }
  listProviders(): ProviderConfig[] {
    return [...this.providers.values()];
  }
  get(id: string): ModelDescriptor | undefined {
    return this.models.get(id);
  }
  getCurrent(): ModelDescriptor | undefined {
    if (this.currentModelId) return this.models.get(this.currentModelId);
    return this.firstByTier("default") ?? this.firstByTier("light");
  }
  setCurrent(id: string) {
    if (!this.models.has(id)) throw new Error(`Unknown model: ${id}`);
    this.currentModelId = id;
  }
  upsertModel(m: ModelDescriptor) {
    this.models.set(m.id, m);
  }
  removeModel(id: string) {
    this.models.delete(id);
    if (this.currentModelId === id) this.currentModelId = undefined;
  }
  upsertProvider(p: ProviderConfig) {
    this.providers.set(p.id, p);
  }
  removeProvider(id: string) {
    this.providers.delete(id);
    for (const m of this.models.values()) {
      m.providers = m.providers.filter((r) => r.id !== id);
    }
  }
  firstByTier(tier: ModelTier): ModelDescriptor | undefined {
    for (const m of this.models.values()) if (m.tier === tier) return m;
    return undefined;
  }
  providersFor(modelId: string): ProviderRef[] {
    const m = this.models.get(modelId);
    if (!m) return [];
    return [...m.providers]
      .filter((r) => this.providers.get(r.id)?.enabled)
      .sort((a, b) => a.priority - b.priority);
  }
  resolveProvider(ref: ProviderRef): ProviderConfig | undefined {
    return this.providers.get(ref.id);
  }
}