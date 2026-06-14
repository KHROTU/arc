import { randomUUID } from "node:crypto";
export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  cost: number;
}
export interface ChatSnapshot {
  chats: ChatMeta[];
  currentId?: string;
  messages: Record<string, unknown[]>;
}
export class ChatHistory {
  private chats: ChatMeta[] = [];
  private currentId: string | undefined;
  private messages: Record<string, unknown[]> = {};
  load(input: { chats?: ChatMeta[]; currentId?: string; messages?: Record<string, unknown[]> }) {
    this.chats = input.chats ?? [];
    this.currentId = input.currentId;
    this.messages = input.messages ?? {};
  }
  snapshot(): ChatSnapshot {
    return { chats: this.chats, currentId: this.currentId, messages: this.messages };
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
  remove(id: string): void {
    this.chats = this.chats.filter((c) => c.id !== id);
    delete this.messages[id];
    if (this.currentId === id) this.currentId = this.chats[0]?.id;
  }
  bump(id: string, cost: number): void {
    const c = this.chats.find((x) => x.id === id);
    if (c) { c.updatedAt = Date.now(); c.cost += cost; }
  }
  getMessages(id: string): unknown[] {
    return this.messages[id] ?? [];
  }
  setMessages(id: string, msgs: unknown[]): void {
    this.messages[id] = msgs;
  }
}