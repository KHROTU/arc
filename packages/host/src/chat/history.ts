import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../protocol/protocol.js";
export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  cost: number;
  promptTokens?: number;
  inputTokens?: number;
  completionTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheReadCost?: number;
  costIn?: number;
  costOut?: number;
}
export interface ChatSnapshot {
  chats: ChatMeta[];
  currentId?: string;
  messages: Record<string, unknown[]>;
  steps: Record<string, unknown[]>;
}
export class ChatHistory {
  private chats: ChatMeta[] = [];
  private currentId: string | undefined;
  private messages: Record<string, unknown[]> = {};
  private steps: Record<string, unknown[]> = {};
  private maxMessages = 100000;
  private maxSteps = 200000;
  private maxSerializedBytes = 512 * 1024 * 1024;
  load(input: { chats?: ChatMeta[]; currentId?: string; messages?: Record<string, unknown[]>; steps?: Record<string, unknown[]> }) {
    this.chats = input.chats ?? [];
    this.currentId = input.currentId;
    this.messages = input.messages ?? {};
    this.steps = input.steps ?? {};
    for (const id of Object.keys(this.messages)) this.trimChat(id);
  }
  snapshot(): ChatSnapshot {
    return { chats: this.chats, currentId: this.currentId, messages: this.messages, steps: this.steps };
  }
  list(): ChatMeta[] {
    return this.chats.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }
  current(): string | undefined {
    return this.currentId;
  }
  create(title?: string): ChatMeta {
    const now = Date.now();
    const c: ChatMeta = {
      id: randomUUID(),
      title: title?.trim() || `New chat \u00b7 ${new Date(now).toLocaleString()}`,
      createdAt: now,
      updatedAt: now,
      cost: 0,
    };
    this.chats.push(c);
    this.currentId = c.id;
    this.messages[c.id] = [];
    this.steps[c.id] = [];
    return c;
  }
  ensure(id?: string): ChatMeta {
    if (id) {
      const found = this.chats.find((c) => c.id === id);
      if (found) {
        this.currentId = found.id;
        return found;
      }
    }
    return this.create();
  }
  switch(id: string): ChatMeta | undefined {
    const c = this.chats.find((x) => x.id === id);
    if (c) this.currentId = c.id;
    return c;
  }
  rename(id: string, title: string): ChatMeta | undefined {
    const c = this.chats.find((x) => x.id === id);
    if (c) { c.title = title.trim() || c.title; c.updatedAt = Date.now(); }
    return c;
  }
  importChat(meta: ChatMeta, messages: ChatMessage[], steps?: unknown[]): boolean {
    if (this.chats.some((c) => c.id === meta.id)) return false;
    this.chats.push(meta);
    this.messages[meta.id] = messages;
    this.steps[meta.id] = steps ?? [];
    this.trimChat(meta.id);
    return true;
  }
  remove(id: string): void {
    this.chats = this.chats.filter((c) => c.id !== id);
    delete this.messages[id];
    delete this.steps[id];
    if (this.currentId === id) this.currentId = this.chats[0]?.id;
  }
  bump(id: string, cost: number, detail?: { inputTokens?: number; cacheRead?: number; cacheWrite?: number; cacheReadCost?: number; costIn?: number; costOut?: number; completionTokens?: number }): void {
    const c = this.chats.find((x) => x.id === id);
    if (!c) return;
    c.updatedAt = Date.now();
    c.cost += cost;
    if (detail) {
      c.inputTokens = (c.inputTokens ?? 0) + (detail.inputTokens ?? 0);
      c.cacheRead = (c.cacheRead ?? 0) + (detail.cacheRead ?? 0);
      c.cacheWrite = (c.cacheWrite ?? 0) + (detail.cacheWrite ?? 0);
      c.cacheReadCost = (c.cacheReadCost ?? 0) + (detail.cacheReadCost ?? 0);
      c.costIn = (c.costIn ?? 0) + (detail.costIn ?? 0);
      c.costOut = (c.costOut ?? 0) + (detail.costOut ?? 0);
      c.completionTokens = (c.completionTokens ?? 0) + (detail.completionTokens ?? 0);
    }
  }
  bumpPromptTokens(id: string, promptTokens: number): void {
    const c = this.chats.find((x) => x.id === id);
    if (c && (!c.promptTokens || promptTokens > c.promptTokens)) c.promptTokens = promptTokens;
  }
  setPromptTokens(id: string, promptTokens: number): void {
    const c = this.chats.find((x) => x.id === id);
    if (c) c.promptTokens = Math.max(0, Math.floor(promptTokens));
  }
  getMessages(id: string): unknown[] {
    return this.messages[id] ?? [];
  }
  setMessages(id: string, msgs: unknown[]): void {
    this.messages[id] = msgs;
    this.trimChat(id);
  }
  setSteps(id: string, s: unknown[]): void {
    this.steps[id] = s;
    this.trimChat(id);
  }
  getSteps(id: string): unknown[] {
    return this.steps[id] ?? [];
  }
  search(query: string): { chat: ChatMeta; matches: { index: number; text: string }[] }[] {
    const lower = query.toLowerCase();
    const results: { chat: ChatMeta; matches: { index: number; text: string }[] }[] = [];
    for (const chat of this.chats) {
      const titleMatch = chat.title.toLowerCase().includes(lower);
      const msgs = this.messages[chat.id] ?? [];
      const matches: { index: number; text: string }[] = [];
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i] as { role?: string; content?: string; toolCallId?: string };
        if (m.role === "tool") continue;
        if (m.role === "assistant" && (m as any).toolCalls?.length) continue;
        if (m.content && m.content.toLowerCase().includes(lower)) {
          matches.push({ index: i, text: m.content.slice(0, 200) });
        }
      }
      if (titleMatch || matches.length > 0) {
        results.push({ chat, matches: titleMatch && matches.length === 0 ? [{ index: -1, text: chat.title }] : matches });
      }
    }
    return results;
  }
  private trimChat(id: string): void {
    const msgs = this.messages[id];
    if (msgs && msgs.length > this.maxMessages) {
      this.messages[id] = msgs.slice(-this.maxMessages);
    }
    if (this.messages[id]) this.messages[id] = trimSerialized(this.messages[id], this.maxSerializedBytes);
    const steps = this.steps[id];
    if (steps && steps.length > this.maxSteps) {
      this.steps[id] = steps.slice(-this.maxSteps);
    }
  }
}
function trimSerialized(items: unknown[], maxBytes: number): unknown[] {
  let bytes = 0;
  const kept: unknown[] = [];
  for (let index = items.length - 1; index >= 0; index--) {
    let size: number;
    try { size = Buffer.byteLength(JSON.stringify(items[index])); }
    catch { continue; }
    if (kept.length && bytes + size > maxBytes) break;
    if (size > maxBytes) continue;
    bytes += size;
    kept.push(items[index]);
  }
  kept.reverse();
  while (kept.length > 0 && (kept[0] as { role?: string }).role === "tool") kept.shift();
  return kept;
}