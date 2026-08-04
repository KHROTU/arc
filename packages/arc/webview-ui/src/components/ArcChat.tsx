import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Settings, Plus, Trash2, Pencil, FoldVertical, HelpCircle, PanelLeftClose, PanelLeft, ShieldCheck, ShieldOff, Search, ArrowLeft, Undo2, X } from "./icons";
import { TodoList, type TodoItemUI } from "./TodoList";
import { FadeSlideIn } from "./anim";
import ArcProcessUI, { type ProcessStep } from "./AgentProcess";
import Composer from "./Composer";
import { AUTO_MODEL_ID } from "./ModelPicker";
import type { Effort } from "./EffortPicker";
import type { ModelDescriptor, TurnUsage, ChatMessage, ProviderSummary, ProviderKind } from "@arc/host/protocol";
import { useArcLogo, swapOnError } from "../hooks/useArcLogo";
import { renderMarkdown } from "../util/markdown";
import type { RpcClient } from "../rpc";
const ConversationSearch = lazy(() => import("./ConversationSearch"));
const SettingsModal = lazy(() => import("./SettingsView"));
type ChatMeta = { id: string; title: string; updatedAt: number; cost: number; isActive: boolean };
type Props = {
  client: RpcClient;
  monoLogo: string;
  prideLogo: string;
  monoLogoText: string;
  prideActive: boolean;
  toolTreeMode: "auto" | "collapsed";
  variant: "sidebar" | "fullscreen";
  version: string;
  providerCatalog: { kind: ProviderKind; label: string; tags: string[]; defaultBaseUrl?: string }[];
};
const WAVE_BAR = { transform: "scaleY(0.28)" };
function WaveSpinner() {
  return (
    <svg className="arc-wave" width="28" height="14" viewBox="0 0 28 14">
      <g fill="var(--vscode-descriptionForeground, #858585)">
        <rect className="arc-wave-bar" style={{ ...WAVE_BAR, animationDelay: "0s" }}    x="0"  y="0" width="4" height="14" rx="2" />
        <rect className="arc-wave-bar" style={{ ...WAVE_BAR, animationDelay: "0.10s" }} x="6"  y="0" width="4" height="14" rx="2" />
        <rect className="arc-wave-bar" style={{ ...WAVE_BAR, animationDelay: "0.20s" }} x="12" y="0" width="4" height="14" rx="2" />
        <rect className="arc-wave-bar" style={{ ...WAVE_BAR, animationDelay: "0.30s" }} x="18" y="0" width="4" height="14" rx="2" />
        <rect className="arc-wave-bar" style={{ ...WAVE_BAR, animationDelay: "0.40s" }} x="24" y="0" width="4" height="14" rx="2" />
      </g>
    </svg>
  );
}
function RippleSpinner() {
  return (
    <svg className="arc-wave" width="28" height="14" viewBox="0 0 28 14">
      <g fill="var(--vscode-descriptionForeground, #858585)">
        <rect className="arc-ripple-bar" style={{ animationDelay: "0.50s" }} x="0"  y="0" width="4" height="14" rx="2" />
        <rect className="arc-ripple-bar" style={{ animationDelay: "0.25s" }} x="6"  y="0" width="4" height="14" rx="2" />
        <rect className="arc-ripple-bar" style={{ animationDelay: "0s" }}    x="12" y="0" width="4" height="14" rx="2" />
        <rect className="arc-ripple-bar" style={{ animationDelay: "0.25s" }} x="18" y="0" width="4" height="14" rx="2" />
        <rect className="arc-ripple-bar" style={{ animationDelay: "0.50s" }} x="24" y="0" width="4" height="14" rx="2" />
      </g>
    </svg>
  );
}
export default function ArcChat({ client, monoLogo, prideLogo, monoLogoText, prideActive, toolTreeMode, variant, version, providerCatalog }: Props) {
  const logoUri = useArcLogo(monoLogo, prideLogo, prideActive);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<{ id: string; text: string; ts?: number } | null>(null);
  const attentionRef = useRef({ enabled: false, volume: 70, completion: true, approval: true, error: true });
  const beep = useCallback((freq: number, dur = 0.12) => {
    const a = attentionRef.current;
    if (!a.enabled) return;
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.07 * (a.volume / 70), ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
} catch {  }
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSidebarList, setShowSidebarList] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [clarification, setClarification] = useState<{ id: string; question: string; options: string[] } | null>(null);
  const [handoff, setHandoff] = useState<{ from: string; to: string; reason: string } | null>(null);
  const [, setUsage] = useState<TurnUsage | null>(null);
  const [ctxStats, setCtxStats] = useState<{ usedPct: number; tokens: number; window: number; cost: number } | null>(null);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [currentModel, setCurrentModel] = useState<string>("");
  const [modes, setModes] = useState<{ slug: string; description: string; source?: string }[]>([]);
  const [currentMode, setCurrentMode] = useState<string>("code");
  const [pendingAttachment, setPendingAttachment] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [hasEverSent, setHasEverSent] = useState(false);
  const [lastTurnError, setLastTurnError] = useState<{ message: string; code?: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showUpdate, setShowUpdate] = useState<{ version: string; url: string } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [approvalQueue, setApprovalQueue] = useState<{ id: string; description: string; kind: string; command?: string }[]>([]);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [prefillText, setPrefillText] = useState<string | null>(null);
  const [polishLevel, setPolishLevel] = useState<"off" | "basic" | "polish">("off");
  const [polishing, setPolishing] = useState(false);
  const [polishPending, setPolishPending] = useState<{ original: string; polished: string } | null>(null);
  const [routing, setRouting] = useState(false);
  const [routePending, setRoutePending] = useState<{ original: string; modelId: string; modelLabel: string } | null>(null);
  const routeRef = useRef<{ text: string; attachments?: { uri: string; preview?: string }[]; images?: string[] } | null>(null);
  const [autoApproveActive, setAutoApproveActive] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<Effort>("high");
  const [resolvedDiffs, setResolvedDiffs] = useState<Record<string, "accepted" | "rejected">>({});
  const transcriptRef = useRef<HTMLDivElement>(null);
  const pendingTextRef = useRef<{ id: string; text: string } | null>(null);
  const rafRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string>("");
  const openedStreamingDiffRef = useRef<string>("");
  const stopSeqRef = useRef(0);
  const cancelStreamFlush = () => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingTextRef.current = null;
  };
  useEffect(() => {
    void Promise.all([
      client.request<boolean>("arc.attention.enabled"),
      client.request<number>("arc.attention.volume"),
      client.request<boolean>("arc.attention.completion"),
      client.request<boolean>("arc.attention.approval"),
      client.request<boolean>("arc.attention.error"),
      client.request<string>("arc.promptPolish"),
    ]).then(([enabled, volume, completion, approval, error, promptPolish]) => {
      attentionRef.current = {
        enabled: enabled === true,
        volume: typeof volume === "number" ? volume : 70,
        completion: completion !== false,
        approval: approval !== false,
        error: error !== false,
      };
      setPolishLevel(promptPolish === "basic" || promptPolish === "polish" ? promptPolish : "off");
    });
    const off = client.on((e: any) => {
      switch (e.type) {
        case "session/init":
          if (e.chatId) setActiveId(e.chatId);
          setModels(e.models);
          setCurrentModel(e.currentModelId);
          if (e.modes) setModes(e.modes);
          if (e.currentMode) setCurrentMode(e.currentMode);
          if (e.reasoningEffort) setReasoningEffort(e.reasoningEffort);
          break;
        case "mode/list":
          if (e.modes) setModes(e.modes);
          break;
        case "chat/list": setChats(e.chats); break;
        case "chat/current":
          cancelStreamFlush();
          sessionIdRef.current = e.chatId;
          setActiveId(e.chatId);
          setShowOnboarding(true);
          setHasEverSent(false);
          setSteps([]);
          setMessages([]);
          setStreaming(null);
          setLastTurnError(null);
          setPendingAttachment(null);
          setPolishing(false);
          setPolishPending(null);
          setApprovalQueue([]);
          break;
        case "session/assistantText":
          if (e.sessionId && sessionIdRef.current && e.sessionId !== sessionIdRef.current) break;
          pendingTextRef.current = { id: e.id, text: e.text };
          if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = null;
              const p = pendingTextRef.current;
              if (p) setStreaming((s) => (s ? { ...s, id: p.id, text: p.text, ts: s.ts ?? Date.now() } : { id: p.id, text: p.text, ts: Date.now() }));
            });
          }
          break;
        case "session/message":
          if (e.sessionId && sessionIdRef.current && e.sessionId !== sessionIdRef.current) break;
          if (e.message.role === "assistant") {
            cancelStreamFlush();
            setStreaming((s) => (s && (s.id === e.message.id || s.id === "pending") ? null : s));
            if (e.message.toolCalls?.length) {
              setStreaming({ id: "pending", text: "" });
            }
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
          setSteps(e.steps);
          break;
        case "session/stepUpdate":
          setSteps((prev) => {
            const idx = prev.findIndex((s) => s.id === e.step.id);
            if (idx < 0) return [...prev, e.step];
            const next = prev.slice();
            next[idx] = e.step;
            return next;
          });
          break;
        case "session/loadComposer":
          setPrefillText(e.text);
          break;
        case "session/replaceState":
          setMessages(e.messages);
          setSteps(e.steps);
          if (e.loadComposer) setPrefillText(e.loadComposer);
          break;
        case "session/turnStart":
          stopSeqRef.current++;
          openedStreamingDiffRef.current = "";
          if (e.sessionId && sessionIdRef.current !== e.sessionId) sessionIdRef.current = e.sessionId;
          setStreaming({ id: "pending", text: "" }); setShowOnboarding(false); setLastTurnError(null); break;
        case "session/turnEnd": stopSeqRef.current++; if (attentionRef.current.completion) beep(880); cancelStreamFlush(); setStreaming(null); break;
        case "session/clarification": setClarification({ id: e.id, question: e.question, options: e.options }); break;
        case "session/guidance":
          break;
        case "session/handoff":
          setHandoff({ from: e.fromModel, to: e.toModel, reason: e.reason });
          setTimeout(() => setHandoff(null), 2400);
          break;
        case "session/attachment": setPendingAttachment(e.preview); break;
        case "session/usage": setUsage(e.usage); break;
        case "context/stats": setCtxStats(e); break;
        case "model/list": setModels(e.models); setCurrentModel(e.currentModelId); break;
        case "provider/list": setProviders(e.providers); break;
        case "ui/showSettings": setShowSettings(true); break;
        case "ui/showUpdate": setShowUpdate({ version: e.version, url: e.url }); break;
        case "ui/showSearch": setShowSearch(true); break;
        case "autoApproveState": setAutoApproveActive(e.active); break;
        case "approval/request":
          if (attentionRef.current.approval) beep(440, 0.2);
          setApprovalQueue((q) => (q.some((a) => a.id === e.id) ? q : [...q.slice(-19), { id: e.id, description: e.description, kind: e.kind, command: e.command }]));
          break;
        case "chat/polishResult":
          setPolishing(false);
          setPolishPending({ original: e.original, polished: e.polished });
          break;
        case "chat/polishFailed":
          setPolishing(false);
          setPolishPending({ original: e.original, polished: e.original });
          break;
        case "chat/routeResult":
          setRouting(false);
          setRoutePending({
            original: e.original,
            modelId: e.modelId,
            modelLabel: e.modelLabel || models.find((m) => m.id === e.modelId)?.label || e.modelId,
          });
          break;
        case "chat/routeFailed":
          {
            setRouting(false);
            const routed = routeRef.current;
            routeRef.current = null;
            if (routed) send(routed.text, routed.attachments, routed.images);
          }
          break;
        case "config/changed":
          if (e.key === "arc.promptPolish") setPolishLevel(e.value === "basic" || e.value === "polish" ? e.value : "off");
          break;
        case "error":
          if (attentionRef.current.error) beep(220, 0.25);
          setLastTurnError({ message: e.message, code: e.code });
          break;
      }
    });
    client.send({ type: "ready" });
    return () => { off(); cancelStreamFlush(); };
  }, [client]);
  useEffect(() => {
    if (streaming && !streaming.text) {
      setWaiting(false);
      const id = setTimeout(() => setWaiting(true), 3000);
      return () => clearTimeout(id);
    }
    setWaiting(false);
  }, [streaming]);
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
  const send = (text: string, attachments?: { uri: string; preview?: string }[], images?: string[], modelId?: string) => {
    if (streaming) {
      setQueuedMessage(text);
      return;
    }
    setRouting(false);
    setRoutePending(null);
    routeRef.current = null;
    setPolishing(false);
    setPolishPending(null);
    setShowOnboarding(false);
    setHasEverSent(true);
    setLastTurnError(null);
    setPendingAttachment(null);
    setMessages((prev) => prev.find((m) => m.content === text && m.role === "user")
      ? prev
      : [...prev, { id: `local-${Date.now()}`, role: "user", content: text, ts: Date.now() }]);
    client.send({ type: "chat/send", text, attachments, images, ...(modelId ? { modelId } : {}) });
  };
  const route = (text: string, attachments?: { uri: string; preview?: string }[], images?: string[]) => {
    routeRef.current = { text, attachments, images };
    setPolishing(false);
    setPolishPending(null);
    setShowOnboarding(false);
    setHasEverSent(true);
    setLastTurnError(null);
    setPendingAttachment(null);
    setRouting(true);
    client.send({ type: "chat/route", text, attachments, images });
  };
  const handleSend = (text: string, attachments?: { uri: string; preview?: string }[], images?: string[]) => {
    if (currentModel === AUTO_MODEL_ID) {
      route(text, attachments, images);
      return;
    }
    send(text, attachments, images);
  };
  const acceptRouted = () => {
    const r = routeRef.current;
    const p = routePending;
    setRoutePending(null);
    setRouting(false);
    routeRef.current = null;
    if (r) send(r.text, r.attachments, r.images, p?.modelId);
  };
  const rejectRouted = () => {
    setRoutePending(null);
    setRouting(false);
    routeRef.current = null;
  };
  const polish = (text: string) => {
    setPolishing(true);
    client.send({ type: "chat/polish", text });
  };
  const stop = () => {
    const seq = ++stopSeqRef.current;
    client.send({ type: "chat/stop" });
    window.setTimeout(() => {
      if (stopSeqRef.current === seq) setStreaming((s) => (s ? null : s));
    }, 5000);
  };
  const guide = (text: string) => client.send({ type: "chat/guidance", text });
  const cancelQueue = () => setQueuedMessage(null);
  useEffect(() => {
    if (!streaming && queuedMessage) {
      const text = queuedMessage;
      setQueuedMessage(null);
      send(text);
    }
  }, [streaming]);
  const newChat = () => { setShowOnboarding(true); client.send({ type: "chat/new" }); };
  const switchChat = (id: string) => client.send({ type: "chat/switch", chatId: id });
  const renameChat = (id: string, title: string) => client.send({ type: "chat/rename", chatId: id, title });
  const deleteChat = (id: string) => client.send({ type: "chat/delete", chatId: id });
  const compact = () => client.send({ type: "chat/compact" });
  const openSettings = () => setShowSettings(true);
  const closeSettings = () => {
    setShowSettings(false);
    void client.request<string>("arc.promptPolish").then((v) => setPolishLevel(v === "basic" || v === "polish" ? v : "off"));
  };
  const openFile = (path: string) => { client.send({ type: "ui/openFile", path }); };
  const selectModel = (id: string) => {
    setCurrentModel(id);
    setRoutePending(null);
    setRouting(false);
    routeRef.current = null;
    if (id === AUTO_MODEL_ID) return;
    client.send({ type: "model/select", modelId: id });
  };
  const selectEffort = (e: Effort) => {
    setReasoningEffort(e);
    client.send({ type: "config/set", key: "arc.reasoning.effort", value: e });
  };
  const selectMode = (mode: string) => {
    setCurrentMode(mode);
    client.send({ type: "mode/select", mode });
  };
  const toggleAutoApprove = () => client.send({ type: "autoApprove/toggle" });
  const approval = approvalQueue[0] ?? null;
  const respondApproval = (allowed: boolean, rememberCommand?: string, rememberPrefix?: string) => {
    const current = approvalQueue[0];
    if (!current) return;
    client.send({ type: "approval/response", id: current.id, allowed, ...(rememberCommand ? { rememberCommand } : {}), ...(rememberPrefix ? { rememberPrefix } : {}) });
    setApprovalQueue((q) => q.slice(1));
  };
  const getApprovalCommand = (desc: string): string | undefined => {
    if (approval?.command) return approval.command;
    const lines = desc.split("\n\n");
    return lines.length > 1 ? lines[1].trim() : undefined;
  };
  const getApprovalPrefix = (desc: string): string | undefined => {
    const cmd = approval?.command ?? getApprovalCommand(desc);
    if (!cmd) return undefined;
    return cmd.trim().split(/\s+/)[0] || undefined;
  };
  useEffect(() => {
    if (!approval) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { respondApproval(false); e.preventDefault(); }
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { respondApproval(true); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [approval]);
  useEffect(() => {
    if (!clarification) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "9" && !e.ctrlKey && !e.metaKey) {
        const idx = parseInt(e.key) - 1;
        if (idx < clarification.options.length) {
          client.send({ type: "chat/answerClarification", id: clarification.id, answer: clarification.options[idx] });
          setClarification(null);
          e.preventDefault();
        }
      }
      if (e.key === "Escape") { setClarification(null); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [clarification]);
  useEffect(() => {
    const onFocus = () => {
      const active = document.activeElement;
      if (!active || active === document.body || active === document.getElementById("root")) {
        (document.querySelector(".arc-composer textarea") as HTMLTextAreaElement)?.focus();
        return;
      }
      const tag = active.tagName.toLowerCase();
      const isEditable = active.getAttribute("contenteditable") === "true";
      if (tag !== "input" && tag !== "textarea" && tag !== "select" && !isEditable) {
        (document.querySelector(".arc-composer textarea") as HTMLTextAreaElement)?.focus();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const pct = ctxStats?.usedPct ?? 0;
  const chatCost = ctxStats?.cost ?? 0;
  const isEmpty = steps.length === 0 && streaming === null && !hasEverSent && !lastTurnError;
  type TimelineItem =
    | { kind: "msg"; ts: number; seq: number; msg: ChatMessage }
    | { kind: "step"; ts: number; seq: number; step: ProcessStep }
    | { kind: "stream"; ts: number; seq: number };
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
    if (streaming?.text && streaming.ts) {
      items.push({ kind: "stream", ts: streaming.ts, seq: seq++ });
    }
    return items.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  }, [messages, steps, streaming]);
  const timelineNodes = useMemo<ReactNode[]>(() => {
    const out: ReactNode[] = [];
    let run: ProcessStep[] = [];
    const handleResolveDiff = (step: ProcessStep, action: "accept" | "reject") => {
      setResolvedDiffs((cur) => ({ ...cur, [step.id]: action === "accept" ? "accepted" : "rejected" }));
      if (action === "reject" && step.filePath) {
        client.send({ type: "diff/reject", stepId: step.id, filePath: step.filePath, hunks: step.diffHunks ?? [] });
      } else if (action === "accept" && step.filePath) {
        client.send({ type: "diff/accept", stepId: step.id, filePath: step.filePath });
      }
    };
    const flush = () => {
      if (run.length) {
        out.push(
          <ArcProcessUI
            key={`steps-${run[0].id}`}
            steps={run}
            onOpenFile={openFile}
            onOpenFullscreenDiff={(payload) => {
              if (!payload.filePath) return;
              client.send({ type: "ui/openFileDiff", path: payload.filePath, hunks: payload.hunks });
            }}
            toolTreeMode={toolTreeMode}
            resolvedDiffs={resolvedDiffs}
            onResolveDiff={handleResolveDiff}
          />,
        );
        run = [];
      }
    };
    for (const item of timeline) {
      if (item.kind === "step") {
        run.push(item.step);
        continue;
      }
      if (item.kind === "stream") {
        flush();
        out.push(
          <div key="stream" className="arc-streaming" aria-live="polite">
            <span className="arc-streaming-text arc-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming?.text ?? "") }} />
          </div>,
        );
        continue;
      }
      const m = item.msg;
      if (m.role === "assistant" && m.toolCalls?.length && !m.content) continue;
      if (m.role === "tool") continue;
      flush();
      out.push(<MessageBubble key={m.id} message={m} client={client} />);
    }
    flush();
    return out;
  }, [timeline, toolTreeMode, variant, resolvedDiffs, client]);
  const latestTodos = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === "todo_list" && steps[i].todos?.length) return steps[i].todos ?? null;
    }
    return null;
  }, [steps]);
  const [todosOpen, setTodosOpen] = useState(true);
  const [todosVisible, setTodosVisible] = useState(false);
  const latestTodosSig = useRef<string | null>(null);
  useEffect(() => {
    if (!latestTodos?.length) return;
    const sig = JSON.stringify(latestTodos);
    if (latestTodosSig.current !== sig) {
      latestTodosSig.current = sig;
      setTodosVisible(true);
      setTodosOpen(true);
    }
  }, [latestTodos]);
  useEffect(() => {
    if (variant !== "sidebar" || streaming || !latestTodos?.length) return;
    const allDone = (items: TodoItemUI[]): boolean =>
      items.every((t) => (t.state === "done" || t.state === "skipped") && (!t.children?.length || allDone(t.children)));
    if (allDone(latestTodos as TodoItemUI[])) setTodosVisible(false);
  }, [variant, streaming, latestTodos]);
  const latestStreamingDiff = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.type !== "tool") continue;
      if (step.toolName !== "file.edit" && step.toolName !== "file.write") continue;
      if (!step.diffHunks || !step.diffHunks.length) continue;
      return { signature: step.id, filePath: step.filePath, hunks: step.diffHunks };
    }
    return null;
  }, [steps]);
  useEffect(() => {
    if (variant !== "sidebar") return;
    if (!streaming) return;
    if (!latestStreamingDiff) return;
    if (!latestStreamingDiff.filePath) return;
    if (openedStreamingDiffRef.current === latestStreamingDiff.signature) return;
    openedStreamingDiffRef.current = latestStreamingDiff.signature;
    client.send({ type: "ui/openFileDiff", path: latestStreamingDiff.filePath, hunks: latestStreamingDiff.hunks });
  }, [variant, streaming, latestStreamingDiff, client]);
  const activeTitle = chats.find((c) => c.id === activeId)?.title ?? "Chat";
  const currentModelLabel = models.find((m) => m.id === currentModel)?.label;
  return (
    <div className={`arc-shell arc-shell-${variant}`}>
      {variant === "sidebar" && showSidebarList ? (
        <div className="arc-body arc-body-sidebar">
          <div className="arc-sidebar-nav">
            <button className="arc-iconbtn" title="Back to chat" onClick={() => setShowSidebarList(false)}>
              <ArrowLeft size={15} />
            </button>
            <span className="arc-sidebar-nav-label">Chats</span>
          </div>
          <div className="arc-sidebar-list-wrap">
            <ChatList
              chats={chats}
              activeId={activeId}
              onSelect={(id) => { switchChat(id); setShowSidebarList(false); }}
              onNew={newChat}
              onSearch={() => client.send({ type: "ui/openFullscreen", show: "search" } as any)}
              onRename={(id) => setRenaming({ id, value: chats.find((x) => x.id === id)?.title ?? "" })}
              onDelete={deleteChat}
              renaming={renaming}
              setRenaming={setRenaming}
              onCommitRename={(id, value) => { renameChat(id, value); setRenaming(null); }}
            />
          </div>
        </div>
      ) : (
        <>
      <header className="arc-topbar">
        {variant === "fullscreen" && (
          <button className="arc-iconbtn" title={sidebarCollapsed ? "Show chat list" : "Hide chat list"} onClick={() => setSidebarCollapsed((c) => !c)}>
            {sidebarCollapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
          </button>
        )}
        {variant === "sidebar" && (
          <>
            <button className="arc-iconbtn" title="Back to chat list" onClick={() => setShowSidebarList(true)}>
              <ArrowLeft size={15} />
            </button>
            <span className="arc-topbar-title" title={activeTitle}>{activeTitle}</span>
          </>
        )}
        <span className="arc-topbar-spacer" />
        <span className="arc-ctx-pct" title={`Context ${pct.toFixed(0)}% used`}>{pct.toFixed(0)}%</span>
        <span className="arc-topbar-cost" title="This chat's spend">${chatCost.toFixed(3)}</span>
        <span className="arc-topbar-sep" />
        <button className="arc-iconbtn" title="Compress context" onClick={compact} disabled={!!streaming}>
          <FoldVertical size={15} />
        </button>
        <button className={`arc-iconbtn ${autoApproveActive ? "arc-iconbtn-active" : ""}`} title={autoApproveActive ? "Disable auto-approve" : "Enable auto-approve (approve all tool calls)"} onClick={toggleAutoApprove}>
          {autoApproveActive ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}
        </button>
        {variant === "fullscreen" && (
          <button className="arc-iconbtn" title="Settings" onClick={openSettings}>
            <Settings size={15} />
          </button>
        )}
      </header>
      <div className={`arc-body arc-body-${variant}`}>
        {variant === "fullscreen" && !sidebarCollapsed && (
          <ChatList
            chats={chats}
            activeId={activeId}
            onSelect={switchChat}
            onNew={newChat}
            onSearch={() => setShowSearch(true)}
            onRename={(id) => setRenaming({ id, value: chats.find((x) => x.id === id)?.title ?? "" })}
            onDelete={deleteChat}
            renaming={renaming}
            setRenaming={setRenaming}
            onCommitRename={(id, value) => { renameChat(id, value); setRenaming(null); }}
            todos={latestTodos as any}
          />
        )}
        <main className="arc-main">
          {handoff && (
            <FadeSlideIn className="arc-handoff-sep">
              <span className="arc-handoff-sep-label">{handoff.to}</span>
            </FadeSlideIn>
          )}
          <div className="arc-transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
            {showOnboarding && isEmpty && (
              <Onboarding logoUri={logoUri} monoLogo={monoLogo} hasModels={models.length > 0} onOpenSettings={openSettings} />
            )}
            {timelineNodes}
            {lastTurnError && !streaming && (
              <div className="arc-transcript-error" role="status">
                {lastTurnError.message}
              </div>
            )}
            {streaming && !streaming.text && (
              <div className="arc-streaming" aria-live="polite">
                <span className="arc-working">
                  {waiting ? <RippleSpinner /> : <WaveSpinner />}
                  {waiting ? "Waiting…" : "Working…"}
                </span>
              </div>
            )}
          </div>
          {clarification && (
            <FadeSlideIn className="arc-approval">
              <div className="arc-approval-row">
                <HelpCircle size={14} className="arc-clar-icon" />
                <span className="arc-approval-label">Clarification needed</span>
              </div>
              <div className="arc-approval-q">{clarification.question}</div>
              <div className="arc-clar-options">
                {clarification.options.map((opt, i) => (
                  <button
                    key={opt}
                    onClick={() => {
                      client.send({ type: "chat/answerClarification", id: clarification.id, answer: opt });
                      setClarification(null);
                    }}
                  >
                    {opt}<kbd>{i + 1}</kbd>
                  </button>
                ))}
              </div>
              <div className="arc-clar-custom">
                <input
                  type="text"
                  placeholder="Type your answer…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      client.send({ type: "chat/answerClarification", id: clarification.id, answer: (e.target as HTMLInputElement).value });
                      setClarification(null);
                    }
                  }}
            />
                <button onClick={() => {
                  const val = (document.querySelector(".arc-clar-custom input") as HTMLInputElement)?.value;
                  if (val) {
                    client.send({ type: "chat/answerClarification", id: clarification.id, answer: val });
                    setClarification(null);
                  }
                }}>↩</button>
              </div>
            </FadeSlideIn>
          )}
          {approval && (
            <FadeSlideIn className="arc-approval">
              <div className="arc-approval-row">
                <span className="arc-approval-dot" />
                <span className="arc-approval-label">Shell command</span>
                <span className="arc-approval-meta">needs approval{approvalQueue.length > 1 ? ` · ${approvalQueue.length - 1} more queued` : ""}</span>
              </div>
              <div className="arc-approval-q">{approval.description.split("\n\n")[0]}</div>
              {approval.description.includes("\n\n") && (
                <div className="arc-approval-body">{approval.description.split("\n\n").slice(1).join("\n\n")}</div>
              )}
              <div className="arc-approval-actions">
                <button className="arc-approval-allow" onClick={() => respondApproval(true, getApprovalCommand(approval.description))} autoFocus>
                  Allow session
                </button>
                <button className="arc-approval-allow" onClick={() => respondApproval(true, undefined, getApprovalPrefix(approval.description))}>
                  Allow prefix
                </button>
                <button className="arc-approval-allow" onClick={() => respondApproval(true)}>
                  Allow once
                </button>
                <button className="arc-approval-deny" onClick={() => respondApproval(false)}>
                  Deny <kbd>Esc</kbd>
                </button>
              </div>
            </FadeSlideIn>
          )}
          <footer className="arc-footer">
            <Composer
              key={activeId}
              onSend={handleSend}
              onStop={stop}
              onGuidance={guide}
              streaming={!!streaming}
              pendingAttachment={pendingAttachment}
              queuedText={queuedMessage}
              onCancelQueue={cancelQueue}
              prefillText={prefillText}
              todos={variant === "sidebar" && todosVisible ? (latestTodos as TodoItemUI[] | null) : null}
              todosOpen={todosOpen}
              onToggleTodos={() => setTodosOpen((o) => !o)}
              polishing={polishing}
              polishPending={polishPending}
              onRejectPolished={() => setPolishPending(null)}
              polishLevel={polishLevel}
              onPolish={polish}
              autoMode={currentModel === AUTO_MODEL_ID}
              routing={routing}
              routePending={routePending ? { modelLabel: routePending.modelLabel } : null}
              onAcceptRouted={acceptRouted}
              onRejectRouted={rejectRouted}
              placeholder={currentModel === AUTO_MODEL_ID ? "Ask anything" : (currentModelLabel ? `Ask ${currentModelLabel}` : undefined)}
              variant={variant}
              models={models}
              currentModelId={currentModel}
              onSelectModel={selectModel}
              modes={modes}
              currentMode={currentMode}
              onSelectMode={selectMode}
              effort={reasoningEffort}
              onSelectEffort={selectEffort}
            />
          </footer>
        </main>
      </div>
      </> )}
      {showSearch && (
        <Suspense fallback={null}>
          <ConversationSearch
            client={client}
            onClose={() => setShowSearch(false)}
          />
        </Suspense>
      )}
      {showUpdate && (
        <div className="arc-modal-overlay" onClick={() => setShowUpdate(null)}>
          <div className="arc-modal" onClick={(e) => e.stopPropagation()}>
            <header className="arc-modal-head">
              <h2>Arc has been updated</h2>
              <button className="arc-iconbtn" onClick={() => setShowUpdate(null)} title="Close"><X size={16} /></button>
            </header>
            <main className="arc-modal-body">
              <div className="arc-settings-inner">
                <div className="arc-update">
                  <p>Arc {showUpdate.version} is here. See what's new in this release.</p>
                  <button className="arc-update-cta" onClick={() => client.send({ type: "ui/openExternal", url: showUpdate.url })}>
                    Release notes
                  </button>
                </div>
              </div>
            </main>
          </div>
        </div>
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            client={client}
            onClose={closeSettings}
            models={models}
            providers={providers}
            monoLogoText={monoLogoText}
            version={version}
            providerCatalog={providerCatalog}
          />
        </Suspense>
      )}
    </div>
  );
}
function MessageBubble({ message, client }: { message: ChatMessage; client?: RpcClient }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  if (isTool) {
    return (
      <div className="arc-bubble arc-bubble-tool" role="note">
        <span className="arc-bubble-tool-id">{message.toolCallId ?? "tool"}</span>
        <pre className="arc-bubble-tool-body">{message.content}</pre>
      </div>
    );
  }
  const userImages = (message as any).images as { image_url: { url: string } }[] | undefined;
  const imgs = userImages?.length ? (
    <div className="arc-bubble-images">
      {userImages.map((img, i) => (
        <img key={i} src={img.image_url.url} alt={`Pasted ${i + 1}`} className="arc-bubble-img" onClick={() => setEnlarged(img.image_url.url)} />
      ))}
    </div>
  ) : null;
  return (
    <>
      <div className={`arc-bubble ${isUser ? "arc-bubble-user" : "arc-bubble-assistant"}`}>
        {isUser && imgs}
        {isUser ? (
          editing ? (
            <div className="arc-bubble-text" style={{ padding: 0 }}>
              <textarea
                ref={editRef}
                autoFocus
                defaultValue={message.content}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const newText = editRef.current?.value ?? "";
                    if (newText.trim()) {
                      client?.send({ type: "chat/editMessage", messageId: message.id, content: message.content, newContent: newText });
                    }
                    setEditing(false);
                  }
                }}
                style={{ width: "100%", minHeight: 40, background: "var(--vscode-input-background)", color: "var(--vscode-input-foreground)", border: "1px solid var(--vscode-input-border)", borderRadius: "var(--arc-radius)", padding: "6px 8px", font: "inherit", fontSize: 13, resize: "none", outline: "none", lineHeight: 1.5 }}
                rows={2}
              />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 4, flexDirection: "row-reverse" }}>
              <div className="arc-bubble-text">{message.content}</div>
              {client && (
                <span style={{ display: "flex", gap: 2, opacity: 0, transition: "opacity 0.18s", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} className="arc-msg-actions">
                  <button className="arc-iconbtn" style={{ width: 22, height: 22 }} title="Revert to here" onClick={() => { client.send({ type: "chat/revertToMessage", messageId: message.id, content: message.content, restoreFiles: true, loadToComposer: true }); }}>
                    <Undo2 size={12} />
                  </button>
                  <button className="arc-iconbtn" style={{ width: 22, height: 22 }} title="Edit message" onClick={() => { setEditing(true); }}>
                    <Pencil size={12} />
                  </button>
                </span>
              )}
            </div>
          )
        ) : (
          <div
            className="arc-bubble-text arc-md"
            dangerouslySetInnerHTML={{ __html: message.content ? renderMarkdown(message.content) : '<span class="arc-bubble-empty">(empty response)</span>' }}
          />
        )}
      </div>
      {enlarged && (
        <div className="arc-image-overlay" onClick={() => setEnlarged(null)}>
          <img src={enlarged} alt="Enlarged" />
        </div>
      )}
    </>
  );
}
function Onboarding({ logoUri, monoLogo, hasModels, onOpenSettings }: { logoUri: string; monoLogo: string; hasModels: boolean; onOpenSettings: () => void }) {
  return (
    <div className="arc-onboarding">
      <img className="arc-onboarding-mark" src={logoUri} alt="Arc" onError={swapOnError(monoLogo)} />
      {hasModels ? (
        <p className="arc-onboarding-hint">Start a new session with the model selector using a profile.</p>
      ) : (
        <p className="arc-onboarding-hint">No configured model. <button className="arc-link" onClick={onOpenSettings}>Open settings →</button></p>
      )}
    </div>
  );
}
function ChatList({
  chats, activeId, onSelect, onNew, onSearch, onRename, onDelete, renaming, setRenaming, onCommitRename, todos,
}: {
  chats: ChatMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSearch: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  renaming: { id: string; value: string } | null;
  setRenaming: (r: { id: string; value: string } | null) => void;
  onCommitRename: (id: string, value: string) => void;
  todos?: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" }[] | null;
}) {
  return (
    <aside className="arc-chatlist">
      <div className="arc-chatlist-head">
        <span>Chats</span>
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button className="arc-iconbtn" title="Search conversations" onClick={onSearch}>
            <Search size={14} />
          </button>
          <button className="arc-iconbtn" onClick={onNew} title="New chat"><Plus size={15} /></button>
        </span>
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
              <span className="arc-chatlist-title" onDoubleClick={(e) => { e.stopPropagation(); onRename(c.id); }}>{c.title}</span>
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
          <TodoList items={todos} level={0} />
        </div>
      )}
    </aside>
  );
}