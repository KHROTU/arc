import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Settings2, Plus, Trash2, Pencil, Maximize2, X, ArrowRight, FoldVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ArcProcessUI, { type ProcessStep } from "./AgentProcess";
import Composer from "./Composer";
import type { ModelDescriptor, ModelTier, TurnUsage, ChatMessage } from "@arc/host/protocol";
import { useArcLogo, swapOnError } from "../hooks/useArcLogo";
import { renderMarkdown } from "../util/markdown";
type ChatMeta = { id: string; title: string; updatedAt: number; cost: number; isActive: boolean };
type Props = {
  client: { send: (m: any) => void; on: (l: (e: any) => void) => () => void };
  monoLogo: string;
  prideLogo: string;
  prideActive: boolean;
  variant: "sidebar" | "fullscreen";
  compressIcon?: string;
};
const TIER_LABEL: Record<ModelTier, string> = { free: "free", light: "light", default: "default", heavy: "heavy" };
export default function ArcChat({ client, monoLogo, prideLogo, prideActive, variant }: Props) {
  const logoUri = useArcLogo(monoLogo, prideLogo, prideActive);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
  const [clarification, setClarification] = useState<{ id: string; question: string; options: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<{ from: string; to: string; reason: string } | null>(null);
  const [, setUsage] = useState<TurnUsage | null>(null);
  const [ctxStats, setCtxStats] = useState<{ usedPct: number; tokens: number; window: number; cost: number } | null>(null);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [currentModel, setCurrentModel] = useState<string>("");
  const [pendingAttachment, setPendingAttachment] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [hasEverSent, setHasEverSent] = useState(false);
  const [lastTurnError, setLastTurnError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const pendingTextRef = useRef<{ id: string; text: string } | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelStreamFlush = () => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingTextRef.current = null;
  };
  useEffect(() => {
    const off = client.on((e: any) => {
      switch (e.type) {
        case "session/init":
          if (e.chatId) setActiveId(e.chatId);
          setModels(e.models);
          setCurrentModel(e.currentModelId);
          break;
        case "chat/list": setChats(e.chats); break;
        case "chat/current":
          cancelStreamFlush();
          setActiveId(e.chatId);
          setShowOnboarding(true);
          setHasEverSent(false);
          setSteps([]);
          setMessages([]);
          setStreaming(null);
          setLastTurnError(null);
          break;
        case "session/assistantText":
          pendingTextRef.current = { id: e.id, text: e.text };
          if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = null;
              const p = pendingTextRef.current;
              if (p) setStreaming((s) => (s ? { ...s, id: p.id, text: p.text } : { id: p.id, text: p.text }));
            });
          }
          break;
        case "session/message":
          if (e.message.role === "assistant") {
            cancelStreamFlush();
            setStreaming((s) => (s && (s.id === e.message.id || s.id === "pending") ? null : s));
          }
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === e.message.id);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = e.message;
              return next;
            }
            if (e.message.role === "user") {
              const localIdx = prev.findIndex(
                (m) =>
                  m.role === "user" &&
                  m.id.startsWith("local-") &&
                  (e.message.content === m.content || e.message.content.startsWith(m.content)),
              );
              if (localIdx >= 0) {
                const next = prev.slice();
                next[localIdx] = e.message;
                return next;
              }
            }
            return [...prev, e.message];
          });
          break;
        case "session/steps":
          setSteps((prev) => (e.steps.length >= prev.length ? e.steps : prev));
          break;
        case "session/turnStart": setStreaming({ id: "pending", text: "" }); setShowOnboarding(false); setLastTurnError(null); break;
        case "session/turnEnd": cancelStreamFlush(); setStreaming(null); break;
        case "session/clarification": setClarification({ id: e.id, question: e.question, options: e.options }); break;
        case "session/handoff":
          setHandoff({ from: e.fromModel, to: e.toModel, reason: e.reason });
          setTimeout(() => setHandoff(null), 2400);
          break;
        case "session/attachment": setPendingAttachment(e.preview); break;
        case "session/usage": setUsage(e.usage); break;
        case "context/stats": setCtxStats(e); break;
        case "model/list": setModels(e.models); setCurrentModel(e.currentModelId); break;
        case "error":
          setError(e.message);
          setLastTurnError(e.message);
          setTimeout(() => setError(null), 4500);
          break;
      }
    });
    client.send({ type: "ready" });
    return () => { off(); cancelStreamFlush(); };
  }, [client]);
  const atBottomRef = useRef(true);
  const onTranscriptScroll = () => {
    const el = transcriptRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    const el = transcriptRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [steps, streaming, clarification, messages]);
  const send = (text: string, attachments?: { uri: string; preview?: string }[]) => {
    setShowOnboarding(false);
    setHasEverSent(true);
    setLastTurnError(null);
    setMessages((prev) => prev.find((m) => m.content === text && m.role === "user")
      ? prev
      : [...prev, { id: `local-${Date.now()}`, role: "user", content: text, ts: Date.now() }]);
    client.send({ type: "chat/send", text, attachments });
  };
  const stop = () => client.send({ type: "chat/stop" });
  const newChat = () => { setShowOnboarding(true); client.send({ type: "chat/new" }); };
  const switchChat = (id: string) => client.send({ type: "chat/switch", chatId: id });
  const renameChat = (id: string, title: string) => client.send({ type: "chat/rename", chatId: id, title });
  const deleteChat = (id: string) => client.send({ type: "chat/delete", chatId: id });
  const compact = () => client.send({ type: "chat/compact" });
  const openSettings = () => client.send({ type: "ui/openSettings" });
  const openFullscreen = () => client.send({ type: "ui/openFullscreen" });
  const selectModel = (id: string) => client.send({ type: "model/select", modelId: id });
  const cur = models.find((m) => m.id === currentModel);
  const pct = ctxStats?.usedPct ?? 0;
  const chatCost = ctxStats?.cost ?? 0;
  const isEmpty = steps.length === 0 && streaming === null && !hasEverSent && !lastTurnError;
  type TimelineItem =
    | { kind: "msg"; ts: number; seq: number; msg: ChatMessage }
    | { kind: "step"; ts: number; seq: number; step: ProcessStep };
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    let seq = 0;
    for (const m of messages) {
      if (m.role === "system") continue;
      items.push({ kind: "msg", ts: m.ts ?? 0, seq: seq++, msg: m });
    }
    for (const s of steps) {
      items.push({ kind: "step", ts: s.ts ?? 0, seq: seq++, step: s });
    }
    return items.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  }, [messages, steps]);
  const timelineNodes = useMemo<ReactNode[]>(() => {
    const out: ReactNode[] = [];
    let run: ProcessStep[] = [];
    const flush = () => {
      if (run.length) {
        out.push(<ArcProcessUI key={`steps-${run[0].id}`} steps={run} />);
        run = [];
      }
    };
    for (const item of timeline) {
      if (item.kind === "step") {
        run.push(item.step);
      } else {
        const m = item.msg;
        if (m.role === "assistant" && !m.content.trim() && m.toolCalls?.length) continue;
        flush();
        out.push(<MessageBubble key={m.id} message={m} />);
      }
    }
    flush();
    return out;
  }, [timeline]);
  const latestTodos = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === "todo_list" && steps[i].todos?.length) return steps[i].todos;
    }
    return null;
  }, [steps]);
  return (
    <div className={`arc-shell arc-shell-${variant}`}>
      <header className="arc-topbar">
        {variant === "fullscreen" && (
          <img className="arc-mark" src={logoUri} alt="Arc" onError={swapOnError(monoLogo)} />
        )}
        <div className="arc-model">
          <select className="arc-modelpicker" value={currentModel} onChange={(e) => selectModel(e.target.value)}>
            {models.length === 0 && <option value="">no models — open settings</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {cur && <span className={`arc-tier arc-tier-${cur.tier}`}>{TIER_LABEL[cur.tier]}</span>}
        </div>
        <span className="arc-topbar-spacer" />
        <ContextMeter pct={pct} />
        <span className="arc-topbar-cost" title="This chat's spend">${chatCost.toFixed(3)}</span>
        <span className="arc-topbar-sep" />
        <button className="arc-iconbtn" title="Compress context" onClick={compact} disabled={!!streaming}>
          <FoldVertical size={15} />
        </button>
        {variant === "sidebar" && (
          <button className="arc-iconbtn" title="Open full-screen" onClick={openFullscreen}>
            <Maximize2 size={14} />
          </button>
        )}
        <button className="arc-iconbtn" title="Settings" onClick={openSettings}>
          <Settings2 size={15} />
        </button>
      </header>
      <div className={`arc-body arc-body-${variant}`}>
        {variant === "fullscreen" && (
          <ChatList
            chats={chats}
            activeId={activeId}
            onSelect={switchChat}
            onNew={newChat}
            onRename={(id) => setRenaming({ id, value: chats.find((x) => x.id === id)?.title ?? "" })}
            onDelete={deleteChat}
            renaming={renaming}
            setRenaming={setRenaming}
            onCommitRename={(id, value) => { renameChat(id, value); setRenaming(null); }}
            todos={latestTodos}
          />
        )}
        <main className="arc-main">
          <AnimatePresence>
            {handoff && (
              <motion.div
                key={handoff.from + handoff.to}
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 450, damping: 30 }}
                className="arc-handoff-banner"
              >
                <span className="arc-handoff-from">{handoff.from}</span>
                <ArrowRight size={12} />
                <span className="arc-handoff-to">{handoff.to}</span>
                <span className="arc-handoff-reason">{handoff.reason}</span>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="arc-transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
            {showOnboarding && isEmpty && (
              <Onboarding logoUri={logoUri} monoLogo={monoLogo} hasModels={models.length > 0} onOpenSettings={openSettings} />
            )}
            {timelineNodes}
            {lastTurnError && !streaming && (
              <div className="arc-transcript-error" role="status">
                <span>{lastTurnError}</span>
              </div>
            )}
            {streaming && (
              <div className="arc-streaming" aria-live="polite">
                {streaming.text
                  ? <span className="arc-streaming-text arc-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming.text) }} />
                  : <span className="arc-working">Working<span className="arc-working-dots" /></span>}
                <span className="arc-cursor" />
              </div>
            )}
            <AnimatePresence>
              {clarification && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="arc-clarification">
                  <div className="arc-clarification-q">{clarification.question}</div>
                  <div className="arc-clarification-options">
                    {clarification.options.map((opt) => (
                      <button
                        key={opt}
                        className="arc-chip"
                        onClick={() => {
                          client.send({ type: "chat/answerClarification", id: clarification.id, answer: opt });
                          setClarification(null);
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <footer className="arc-footer">
            <AnimatePresence>
              {error && (
                <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} className="arc-errorbar">
                  <X size={13} /> <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>
            <Composer
              key={activeId}
              onSend={send}
              onStop={stop}
              streaming={!!streaming}
              pendingAttachment={pendingAttachment}
            />
          </footer>
        </main>
      </div>
    </div>
  );
}
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  if (isTool) {
    return (
      <div className="arc-bubble arc-bubble-tool" role="note">
        <span className="arc-bubble-tool-id">{message.toolCallId ?? "tool"}</span>
        <pre className="arc-bubble-tool-body">{message.content}</pre>
      </div>
    );
  }
  if (isUser) {
    return (
      <div className="arc-bubble arc-bubble-user">
        <div className="arc-bubble-text">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="arc-bubble arc-bubble-assistant">
      <div
        className="arc-bubble-text arc-md"
        dangerouslySetInnerHTML={{ __html: message.content ? renderMarkdown(message.content) : '<span class="arc-bubble-empty">(empty response)</span>' }}
      />
    </div>
  );
}
function ContextMeter({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className="arc-ctx" title={`Context ${clamped.toFixed(0)}% used`}>
      <span className="arc-ctx-track"><span className="arc-ctx-fill" style={{ width: `${clamped}%` }} /></span>
      <span className="arc-ctx-pct">{clamped.toFixed(0)}%</span>
    </span>
  );
}
function Onboarding({ logoUri, monoLogo, hasModels, onOpenSettings }: { logoUri: string; monoLogo: string; hasModels: boolean; onOpenSettings: () => void }) {
  return (
    <div className="arc-onboarding">
      <img className="arc-onboarding-mark" src={logoUri} alt="Arc" onError={swapOnError(monoLogo)} />
      <h2>Welcome to Arc</h2>
      <p>Arc picks the right model per subtask, hands hard problems to heavier models, and brings you back when it's done.</p>
      <ol className="arc-onboarding-steps">
        <li><span className="arc-onboarding-num">1</span> Add a <strong>provider</strong> and bind it to a <strong>model</strong> with a tier.</li>
        <li><span className="arc-onboarding-num">2</span> Pick your model in the top bar.</li>
        <li><span className="arc-onboarding-num">3</span> Describe a task below — Arc takes it from there.</li>
      </ol>
      {!hasModels && <button className="arc-btn" onClick={onOpenSettings}><Settings2 size={14} /> Open settings</button>}
    </div>
  );
}
function ChatList({
  chats, activeId, onSelect, onNew, onRename, onDelete, renaming, setRenaming, onCommitRename, todos,
}: {
  chats: ChatMeta[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  renaming: { id: string; value: string } | null;
  setRenaming: (r: { id: string; value: string } | null) => void;
  onCommitRename: (id: string, value: string) => void;
  todos: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" }[] | null;
}) {
  return (
    <aside className="arc-chatlist">
      <div className="arc-chatlist-head">
        <span>Chats</span>
        <button className="arc-iconbtn" onClick={onNew} title="New chat"><Plus size={15} /></button>
      </div>
      <ul className="arc-chatlist-list">
        {chats.length === 0 && <li className="arc-chatlist-empty">No chats yet.</li>}
        {chats.map((c) => (
          <li key={c.id} className={`arc-chatlist-item ${c.id === activeId ? "is-active" : ""}`} onClick={() => onSelect(c.id)}>
            {renaming?.id === c.id ? (
              <input
                className="arc-chatlist-rename"
                autoFocus
                value={renaming.value}
                onChange={(e) => setRenaming({ id: c.id, value: e.target.value })}
                onBlur={() => onCommitRename(c.id, renaming.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitRename(c.id, renaming.value);
                  if (e.key === "Escape") setRenaming(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="arc-chatlist-title" onDoubleClick={(e) => { e.stopPropagation(); onRename(c.id); }}>
                {truncate(c.title, 24)}
              </span>
            )}
            <span className="arc-chatlist-cost">${c.cost.toFixed(3)}</span>
            <span className="arc-chatlist-actions">
              <button className="arc-chatlist-action" title="Rename" onClick={(e) => { e.stopPropagation(); onRename(c.id); }}><Pencil size={12} /></button>
              <button className="arc-chatlist-action" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}><Trash2 size={12} /></button>
            </span>
          </li>
        ))}
      </ul>
      {todos && todos.length > 0 && (
        <div className="arc-todo-sidebar">
          <ul className="arc-todo-sidebar-list">
            {todos.map((t) => (
              <li key={t.id} className={`arc-todo-sidebar-item arc-todo-sidebar-item-${t.state}`}>
                <span className="arc-todo-sidebar-mark">
                  {t.state === "done" ? "✓" : t.state === "in_progress" ? "●" : "○"}
                </span>
                <span className="arc-todo-sidebar-text">{t.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}