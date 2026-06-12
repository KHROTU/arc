import { randomUUID } from "node:crypto";
export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  cost: number;
}
export class ChatHistory {
  private chats: ChatMeta[] = [];
  private currentId: string | undefined;
  load(input: { chats?: ChatMeta[]; currentId?: string }) {
    this.chats = input.chats ?? [];
    this.currentId = input.currentId;
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
      title: title?.trim() || `New chat · ${new Date(now).toLocaleString()}`,
      createdAt: now,
      updatedAt: now,
      cost: 0,
    };
    this.chats.push(c);
    this.currentId = c.id;
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
    if (this.currentId === id) this.currentId = this.chats[0]?.id;
  }
  bump(id: string, cost: number): void {
    const c = this.chats.find((x) => x.id === id);
    if (c) { c.updatedAt = Date.now(); c.cost += cost; }
  }
}