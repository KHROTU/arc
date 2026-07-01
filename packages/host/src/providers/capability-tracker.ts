export class CapsTracker {
  private unsupported = new Map<string, Set<string>>();
  markUnsupported(modelKey: string, feature: string): void {
    let s = this.unsupported.get(modelKey);
    if (!s) { s = new Set(); this.unsupported.set(modelKey, s); }
    s.add(feature);
  }
  isSupported(modelKey: string, feature: string): boolean {
    return !this.unsupported.get(modelKey)?.has(feature);
  }
}
export const caps = new CapsTracker();