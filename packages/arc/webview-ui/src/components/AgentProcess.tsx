import { useState, useEffect, memo, useCallback, useMemo, useRef } from "react";
import { Expand, FadeSlideIn, ScaleIn, RotateArrow } from "./anim";
import {
  ChevronRight, Bot, ArrowRight, Check, Circle, CircleDot,
  HelpCircle, CornerDownLeft, Sparkles, AlertTriangle, Terminal, ExternalLink, StopCircle, Maximize2,
} from "./icons";
import ModelIcon from "./ModelIcon";
import type { ProcessStep as HostProcessStep, DiffHunk as HostDiffHunk, TodoItem as HostTodoItem } from "@arc/host/protocol";
export type StepType = HostProcessStep["type"];
export interface TodoItem extends HostTodoItem {}
export type DiffHunk = HostDiffHunk;
export interface ProcessStep extends HostProcessStep {
  noMark?: boolean;
}
const AnimatedNumber = memo(({ value }: { value: number }) => (
  <span className="arc-proc-count">
    <span key={value} style={{ display: "inline-block", animation: "arc-slide-down-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }}>
      {value}
    </span>
  </span>
));
AnimatedNumber.displayName = "AnimatedNumber";
const KEYWORDS =
  /\b(clone|find|type|sort|gh|git|echo|cat|ls|cd|mkdir|rm|cp|mv|npm|pnpm|yarn|pip|python|node|grep|rg|curl|wget|head|tail|sed|awk|docker|make)\b/g;
function highlight(text: string, isOutput?: boolean): string {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = safe
    .replace(KEYWORDS, '<span class="arc-syn-kw">$1</span>')
    .replace(/("stdout"|"stderr"|"interrupted"|"isImage"|"noOutputExpected")/g, '<span class="arc-syn-key">$1</span>')
    .replace(/(\sError:|\bError:)/g, '<span class="arc-syn-err">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="arc-syn-num">$1</span>')
    .replace(/(\s)(--?[a-z][\w-]*)/gi, '$1<span class="arc-syn-flag">$2</span>');
  if (isOutput && text.trim().startsWith("{")) {
    html = html.replace(/: ("[^"]*")/g, ': <span class="arc-syn-str">$1</span>');
  }
  return html;
}
const Code = memo(({ text, isOutput }: { text: string; isOutput?: boolean }) => {
  if (!text) return null;
  return <span className="arc-code-text" dangerouslySetInnerHTML={{ __html: highlight(text, isOutput) }} />;
});
Code.displayName = "Code";
const DiffView = memo(({ hunks, filePath, onOpenFile, onOpenFullscreenDiff, resolution, onResolve }: { hunks: DiffHunk[]; filePath?: string; onOpenFile?: (path: string) => void; onOpenFullscreenDiff?: (payload: { filePath?: string; hunks: DiffHunk[] }) => void; resolution?: "accepted" | "rejected"; onResolve?: (action: "accept" | "reject") => void }) => {
  let oldLine = 1;
  let newLine = 1;
  return (
    <div className="arc-diff">
      {filePath && (
        <div className="arc-diff-file">
          <span className="arc-diff-file-icon">+</span>
          <span className="arc-diff-file-name">{filePath}</span>
                    {onOpenFile && (
            <button className="arc-diff-file-open" title="Open file" aria-label={`Open ${filePath}`} onClick={(e) => { e.stopPropagation(); onOpenFile(filePath!); }}>
              <ExternalLink size={12} />
            </button>
          )}
          <span className="arc-diff-file-spacer" />
          {onOpenFullscreenDiff && (
            <button className="arc-diff-file-open" title="Open fullscreen diff" aria-label="Open fullscreen diff" onClick={(e) => { e.stopPropagation(); onOpenFullscreenDiff({ filePath, hunks }); }}>
              <Maximize2 size={12} />
            </button>
          )}
        </div>
      )}
      {onResolve && (
        <div className="arc-diff-actions">
          {resolution ? (
            <span className={`arc-diff-resolution ${resolution}`}>{resolution === "accepted" ? "Accepted" : "Rejected"}</span>
          ) : (
            <>
              <button className="arc-btn-ghost" onClick={(e) => { e.stopPropagation(); onResolve("reject"); }}>Reject</button>
              <button className="arc-btn" onClick={(e) => { e.stopPropagation(); onResolve("accept"); }}><Check size={13} /> Accept</button>
            </>
          )}
        </div>
      )}
      <div className="arc-diff-body">
        {hunks.map((h, hi) => {
          const lines = h.value ? h.value.split("\n") : [""];
          if (lines[lines.length - 1] === "") lines.pop();
          return lines.map((raw, li) => {
            const cls = h.added ? "arc-diff-add" : h.removed ? "arc-diff-rem" : "arc-diff-context";
            const sign = h.added ? "+" : h.removed ? "-" : " ";
            const curOld = h.removed || (!h.added && !h.removed) ? oldLine++ : undefined;
            const curNew = h.added || (!h.added && !h.removed) ? newLine++ : undefined;
            return (
              <div key={`${hi}-${li}`} className={cls}>
                <span className="arc-diff-sign">{sign}</span>
                <span className="arc-diff-old">{curOld !== undefined ? String(curOld).padStart(3, " ") : "   "}</span>
                <span className="arc-diff-new">{curNew !== undefined ? String(curNew).padStart(3, " ") : "   "}</span>
                <span className="arc-diff-text">{raw}</span>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
});
DiffView.displayName = "DiffView";
function StatusDot({ type, interrupted, pending }: { type: StepType; interrupted?: boolean; pending?: boolean }) {
  if (interrupted) return <StopCircle className="arc-proc-dot-icon is-err" size={12} strokeWidth={2.25} />;
  if (type === "result") return <Check className="arc-proc-dot-icon is-ok" size={13} strokeWidth={2.5} />;
  if (type === "error") return <AlertTriangle className="arc-proc-dot-icon is-err" size={12} strokeWidth={2.25} />;
  if (type === "handoff") return <ArrowRight className="arc-proc-dot-icon is-accent" size={12} strokeWidth={2.25} />;
  if (type === "clarification") return <HelpCircle className="arc-proc-dot-icon is-accent" size={12} strokeWidth={2.25} />;
  if (type === "thought") return <Sparkles className="arc-proc-dot-icon is-muted" size={11} strokeWidth={2} />;
  if (type === "todo_list") return <CircleDot className="arc-proc-dot-icon is-muted" size={11} strokeWidth={2} />;
  return <span className={`arc-proc-dot${pending ? " is-live" : ""}`} />;
}
const HandoffBlock = memo(({ from, to, reason }: { from?: string; to?: string; reason?: string }) => (
  <div className="arc-proc-handoff">
    <div className="arc-proc-handoff-route">
      <span className="arc-proc-handoff-from">{from}</span>
      <ArrowRight size={12} className="arc-proc-handoff-arrow" />
      <span className="arc-proc-handoff-to">{to}</span>
    </div>
    {reason && <div className="arc-proc-handoff-reason">{reason}</div>}
  </div>
));
HandoffBlock.displayName = "HandoffBlock";
const TodoListBlock = memo(({ todos }: { todos: TodoItem[] }) => (
  <ul className="arc-proc-todos">
    {todos.map((todo) => {
      const active = todo.state === "in_progress";
      const done = todo.state === "done";
      const skipped = todo.state === "skipped";
      const blocked = todo.state === "blocked";
      const failed = todo.state === "failed";
      return (
          <li key={todo.id} className={`arc-proc-todo arc-proc-todo-${todo.state}`}>
          <span className="arc-proc-todo-mark">
            {done ? (
              <ScaleIn>
                <Check size={13} strokeWidth={2.5} />
              </ScaleIn>
            ) : active ? (
              <span className="arc-proc-todo-pulse" />
            ) : skipped ? (
              <Circle size={12} />
            ) : blocked ? (
              <StopCircle size={12} />
            ) : failed ? (
              <AlertTriangle size={12} />
            ) : (
              <Circle size={12} />
            )}
          </span>
          <span className="arc-proc-todo-text">{todo.text}</span>
        </li>
      );
    })}
  </ul>
));
TodoListBlock.displayName = "TodoListBlock";
const ClarificationBlock = memo(({ question, options }: { question?: string; options?: string[] }) => (
  <div className="arc-proc-clar">
    <div className="arc-proc-clar-q">
      <HelpCircle size={14} className="arc-proc-clar-icon" />
      <span>{question}</span>
    </div>
    {options && options.length > 0 && (
      <div className="arc-proc-clar-options">
        {options.map((opt) => (
          <button key={opt} className="arc-chip">{opt}</button>
        ))}
      </div>
    )}
    <div className="arc-proc-clar-input">
      <input type="text" placeholder="Type an answer…" />
      <button type="button" aria-label="Submit answer"><CornerDownLeft size={13} /></button>
    </div>
  </div>
));
ClarificationBlock.displayName = "ClarificationBlock";
export type ToolTreeMode = "auto" | "collapsed";
type GroupSummaryMode = import("@arc/host").GroupSummaryMode;
const GROUP_SUMMARY_CAP = 50;
type ToolPhrase = readonly [verb: string, object: string];
const TOOL_PHRASES: Record<string, ToolPhrase> = {
  "file.read": ["Read", "files"],
  "notebook.read": ["Read", "files"],
  "file.edit": ["Edited", "files"],
  "file.write": ["Wrote", "files"],
  "file.grep": ["Searched", "files"],
  "file.glob": ["Globbed", "files"],
  "file.semanticSearch": ["Ran", "semantic search"],
  "shell.run": ["Ran", "commands"],
  "shell.backgroundRun": ["Started", "background process"],
  "shell.check": ["Checked", "processes"],
  "shell.write": ["Managed", "processes"],
  "shell.customRun": ["Created", "custom runs"],
  "shell.editCustomRun": ["Edited", "custom runs"],
  "shell.runCustomRun": ["Ran", "custom runs"],
  "lsp.problems": ["Checked", "diagnostics"],
  "lsp.problemsFor": ["Checked", "diagnostics"],
  "todo.write": ["Updated", "plan"],
  "web.search": ["Searched", "the web"],
  "web.fetch": ["Fetched", "pages"],
  "mcp.call": ["Called", "MCP tools"],
  "mcp.create": ["Registered", "MCP servers"],
  "mcp.remove": ["Removed", "MCP servers"],
  "mcp.toggle": ["Toggled", "MCP servers"],
  "mcp.resources/list": ["Listed", "MCP resources"],
  "mcp.resources/read": ["Read", "MCP resources"],
  "mcp.prompts/list": ["Listed", "MCP prompts"],
  "mcp.prompts/get": ["Fetched", "MCP prompts"],
  "test.run": ["Ran", "tests"],
  "subagent.spawn": ["Spawned", "subagents"],
  "subagent.askParent": ["Asked", "the parent"],
  "clarification.askUser": ["Asked", "questions"],
  "checkpoint.list": ["Listed", "checkpoints"],
  "checkpoint.revert": ["Reverted", "checkpoints"],
  "checkpoint.compare": ["Compared", "checkpoints"],
  "handoff": ["Handed off", "models"],
  "context.retrieve": ["Retrieved", "context"],
  "memory.add": ["Updated", "memory"],
  "memory.note": ["Saved", "notes"],
  "memory.list": ["Listed", "memories"],
  "memory.edit": ["Edited", "memory"],
  "memory.delete": ["Deleted", "memory"],
  "mode.switch": ["Switched", "modes"],
  "skill.use": ["Loaded", "skills"],
  "skill.read": ["Read", "skills"],
  "rule.list": ["Listed", "rules"],
  "rule.read": ["Read", "rules"],
  "rule.create": ["Created", "rules"],
  "session.exportTrace": ["Exported", "trace"],
};
const TOOL_PREFIX_PHRASES: [string, ToolPhrase][] = [
  ["browser.", ["Used", "the browser"]],
  ["notebook.", ["Edited", "notebooks"]],
  ["git.", ["Inspected", "git"]],
  ["wait.", ["Waited", ""]],
];
function toolPair(name: string | undefined): ToolPhrase | undefined {
  if (!name) return undefined;
  if (TOOL_PHRASES[name]) return TOOL_PHRASES[name];
  for (const [prefix, pair] of TOOL_PREFIX_PHRASES) {
    if (name.startsWith(prefix)) return pair;
  }
  return undefined;
}
function labelOf(p: ToolPhrase): string {
  return p[1] ? `${p[0]} ${p[1]}` : p[0];
}
function joinPair(a: ToolPhrase, b?: ToolPhrase): string {
  if (!b) return labelOf(a);
  const [v1, o1] = a;
  const [v2, o2] = b;
  if (o1 && o2 && o1 === o2) return `${v1} and ${v2.toLowerCase()} ${o1}`;
  if (v1 === v2) return o2 ? `${v1} ${o1} and ${o2}` : labelOf(a);
  if (!o2) return `${v1} ${o1} and ${v2.toLowerCase()}`;
  return `${v1} ${o1} and ${v2.toLowerCase()} ${o2}`;
}
function topToolLabel(children: ProcessStep[] | undefined): string {
  const counts = new Map<string, { pair: ToolPhrase; n: number }>();
  const visit = (s: ProcessStep): void => {
    const p = toolPair(s.toolName);
    if (p) {
      const key = labelOf(p);
      const e = counts.get(key);
      if (e) e.n += 1;
      else counts.set(key, { pair: p, n: 1 });
    }
    for (const c of s.children ?? []) visit(c);
  };
  for (const c of children ?? []) visit(c);
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n).map((e) => e.pair);
  if (!ranked.length) return "";
  return ranked.length === 1 ? joinPair(ranked[0]) : joinPair(ranked[0], ranked[1]);
}
const savedGroupTitles = new Set<string>();
const GroupNode = memo(({ step, onOpenFile, onOpenFullscreenDiff, toolTreeMode, resolvedDiffs, onResolveDiff, groupSummaryMode = "count", requestAISummary, saveGroupTitle }: { step: ProcessStep; onOpenFile?: (path: string) => void; onOpenFullscreenDiff?: (payload: { filePath?: string; hunks: DiffHunk[] }) => void; toolTreeMode: ToolTreeMode; resolvedDiffs?: Record<string, "accepted" | "rejected">; onResolveDiff?: (step: ProcessStep, action: "accept" | "reject") => void; groupSummaryMode?: GroupSummaryMode; requestAISummary?: (groupId: string, titles: string[]) => Promise<string>; saveGroupTitle?: (stepId: string, title: string, mode: string) => void }) => {
  const [open, setOpen] = useState(step.type === "subagent" || toolTreeMode === "auto");
  const childCount = step.children?.length || 0;
  const isToolGroup = step.type === "tool_group";
  const ended = isToolGroup && !!step.children?.length && step.children.every((s) => s.pending === false);
  const lastChildId = isToolGroup ? step.children?.[step.children.length - 1]?.id : undefined;
  const lastChildTitle = isToolGroup ? step.children?.[step.children.length - 1]?.groupTitle : undefined;
  const [aiTitle, setAiTitle] = useState("");
  useEffect(() => {
    if (!ended || !isToolGroup || !lastChildId || !saveGroupTitle) return;
    if (lastChildTitle) return;
    if (savedGroupTitles.has(lastChildId)) return;
    if (groupSummaryMode === "tools") {
      const label = topToolLabel(step.children);
      if (label) {
        savedGroupTitles.add(lastChildId);
        saveGroupTitle(lastChildId, label.slice(0, GROUP_SUMMARY_CAP), "tools");
      }
    }
  }, [lastChildId, ended, groupSummaryMode, lastChildTitle, saveGroupTitle]);
  useEffect(() => {
    if (!ended || !isToolGroup || !lastChildId || !requestAISummary || groupSummaryMode !== "ai") return;
    if (lastChildTitle && step.children?.[step.children.length - 1]?.groupTitleMode === "ai") {
      setAiTitle(lastChildTitle);
      return;
    }
    if (savedGroupTitles.has(lastChildId)) return;
    savedGroupTitles.add(lastChildId);
    let cancelled = false;
    setAiTitle("");
    const titles = [...new Set((step.children ?? []).flatMap((c) => [c.title, ...(c.children ?? []).map((g) => g.title)]).filter(Boolean) as string[])].slice(0, 60);
    requestAISummary(step.id, titles).then((t) => {
      if (cancelled || !t) return;
      const text = t.length > GROUP_SUMMARY_CAP ? `${t.slice(0, GROUP_SUMMARY_CAP - 1)}…` : t;
      setAiTitle(text);
      saveGroupTitle?.(lastChildId, text, "ai");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [step.id, ended, groupSummaryMode, requestAISummary, lastChildId, lastChildTitle]);
  let groupTitle = step.title || "Called";
  if (ended && isToolGroup && groupSummaryMode !== "count") {
    if (lastChildTitle) {
      groupTitle = lastChildTitle;
    } else if (groupSummaryMode === "tools") {
      const label = topToolLabel(step.children);
      if (label) groupTitle = label;
    } else if (groupSummaryMode === "ai" && aiTitle) {
      groupTitle = aiTitle;
    }
  }
  return (
    <div className="arc-proc-group">
      <button className={`arc-proc-group-toggle${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="arc-proc-group-icon-wrap">
          <ChevronRight size={14} className="arc-proc-group-icon-chevron" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} />
          {step.type === "subagent" ? (
            step.modelId ? (
              <ModelIcon modelId={step.modelId} size={14} className="arc-proc-group-icon" title={step.modelLabel} />
            ) : (
              <Bot size={14} className="arc-proc-group-icon is-accent" />
            )
          ) : (
            <Terminal size={13} className="arc-proc-group-icon" />
          )}
        </span>
        <span className="arc-proc-group-title">{groupTitle}</span>
        {step.type === "tool_group" && (!ended || groupSummaryMode === "count") && (
          <span className="arc-proc-group-meta">
            <AnimatedNumber value={childCount} /> {childCount === 1 ? "tool" : "tools"}
          </span>
        )}
      </button>
      <Expand open={open && !!step.children}>
        {step.children && (
          <div className="arc-proc-children">
            <span className="arc-proc-treeline" />
            {step.modelLabel && <div className="arc-proc-model-line">{step.modelLabel}</div>}
            <StepList steps={step.children} onOpenFile={onOpenFile} onOpenFullscreenDiff={onOpenFullscreenDiff} toolTreeMode={toolTreeMode} resolvedDiffs={resolvedDiffs} onResolveDiff={onResolveDiff} />
          </div>
        )}
      </Expand>
    </div>
  );
});
GroupNode.displayName = "GroupNode";
const ThoughtNode = memo(({ step }: { step: ProcessStep }) => {
  const [open, setOpen] = useState(false);
  const secs = ((step.durationMs ?? 0) / 1000).toFixed(1);
  const hasContent = !!step.content;
  const showBody = hasContent && (open || !!step.pending);
  return (
    <FadeSlideIn className="arc-proc-node arc-proc-node-thought">
      <button
        className="arc-proc-row"
        onClick={() => hasContent && setOpen((o) => !o)}
        disabled={!hasContent}
        aria-expanded={hasContent ? showBody : undefined}
      >
        <span className="arc-proc-row-mark"><StatusDot type="thought" interrupted={step.interrupted} pending={step.pending} /></span>
        <span className="arc-proc-title arc-proc-title-thought">
          {step.pending ? <>Thinking<span className="arc-working-dots" /></> : `Thought for ${secs} seconds`}
        </span>
        {hasContent && !step.pending && (
          <RotateArrow open={open} />
        )}
      </button>
      <Expand open={showBody}>
        <div className="arc-proc-children">
          <span className="arc-proc-treeline" />
          <div className="arc-proc-text is-thought">{step.content}</div>
        </div>
      </Expand>
    </FadeSlideIn>
  );
});
ThoughtNode.displayName = "ThoughtNode";
const ProcessNode = memo(({ step, isActive, onToggle, onOpenFile, onOpenFullscreenDiff, toolTreeMode, resolvedDiffs, onResolveDiff, groupSummaryMode, requestAISummary, saveGroupTitle }: { step: ProcessStep; isActive: boolean; onToggle: () => void; onOpenFile?: (path: string) => void; onOpenFullscreenDiff?: (payload: { filePath?: string; hunks: DiffHunk[] }) => void; toolTreeMode: ToolTreeMode; resolvedDiffs?: Record<string, "accepted" | "rejected">; onResolveDiff?: (step: ProcessStep, action: "accept" | "reject") => void; groupSummaryMode?: GroupSummaryMode; requestAISummary?: (groupId: string, titles: string[]) => Promise<string>; saveGroupTitle?: (stepId: string, title: string, mode: string) => void }) => {
  if (step.type === "tool_group") return <GroupNode step={step} onOpenFile={onOpenFile} onOpenFullscreenDiff={onOpenFullscreenDiff} toolTreeMode={toolTreeMode} resolvedDiffs={resolvedDiffs} onResolveDiff={onResolveDiff} groupSummaryMode={groupSummaryMode} requestAISummary={requestAISummary} saveGroupTitle={saveGroupTitle} />;
  if (step.type === "subagent") return <GroupNode step={step} onOpenFile={onOpenFile} onOpenFullscreenDiff={onOpenFullscreenDiff} toolTreeMode={toolTreeMode} resolvedDiffs={resolvedDiffs} onResolveDiff={onResolveDiff} />;
  if (step.type === "thought") return <ThoughtNode step={step} />;
  const isReadTool = step.toolName === "file.read";
  const isNoDetail = isReadTool || step.toolName === "web.fetch";
  const isWriteTool = step.toolName === "file.write";
  const isEditTool = step.toolName === "file.edit";
  const hasDiff = isWriteTool || isEditTool;
  const hasChildren = !!step.children?.length;
  const hasDetails = hasChildren || (!isNoDetail && (!!step.command || !!step.output || !!step.content || !!step.todos || !!step.options || !!step.runAfterCommand || !!step.runAfterOutput || step.type === "handoff" || hasDiff || (hasDiff && !!step.diffHunks?.length)));
  return (
    <FadeSlideIn className={`arc-proc-node arc-proc-node-${step.type}`}>
      <button
        className={`arc-proc-row${step.noMark ? " is-flush" : ""}${step.pending ? " is-pending" : ""}`}
        onClick={() => hasDetails && onToggle()}
        disabled={!hasDetails}
        aria-expanded={hasDetails ? isActive : undefined}
      >
        {!step.noMark && (
          <span className="arc-proc-row-mark">
            {step.toolName === "subagent.spawn" && step.modelId ? (
              <ModelIcon modelId={step.modelId} size={13} className="arc-proc-dot-icon is-muted" title={step.modelLabel} />
            ) : (
              <StatusDot type={step.type} interrupted={step.interrupted} pending={step.pending} />
            )}
          </span>
        )}
        <span className="arc-proc-title">{step.title}{step.pending ? <span className="arc-working-dots" /> : null}{step.interrupted ? <span className="arc-proc-interrupted">(stopped)</span> : null}</span>
        {hasDetails && (
          <RotateArrow open={isActive} />
        )}
      </button>
      <Expand open={isActive && hasDetails}>
        <div className="arc-proc-detail">
              {step.modelLabel && (
                <div className="arc-proc-model-line">{step.modelLabel}</div>
              )}
              {step.content && step.type !== "clarification" && (
                <div className={`arc-proc-text ${step.type === "result" ? "is-result" : ""}`}>
                  {step.content}
                </div>
              )}
              {step.command && (
                <div className="arc-proc-block">
                  <span className="arc-proc-block-label">Command</span>
                  <div className="arc-code"><Code text={step.command} /></div>
                </div>
              )}
              {hasDiff && (!step.diffHunks || step.diffHunks.length === 0) && step.pending && (
                <div className="arc-proc-block">
                  <span className="arc-proc-block-label">Diff</span>
                  <div className="arc-proc-text" style={{ color: "var(--vscode-descriptionForeground)", fontStyle: "italic" }}>Writing<span className="arc-working-dots" /></div>
                </div>
              )}
              {hasDiff && step.diffHunks && step.diffHunks.length > 0 && (
                <div className="arc-proc-block">
                  <span className="arc-proc-block-label">Diff</span>
                  <DiffView
                    hunks={step.diffHunks}
                    filePath={step.filePath}
                    onOpenFile={onOpenFile}
                    onOpenFullscreenDiff={onOpenFullscreenDiff}
                    resolution={resolvedDiffs?.[step.id]}
                    onResolve={onResolveDiff ? (action) => onResolveDiff(step, action) : undefined}
                  />
                </div>
              )}
              {!hasDiff && step.output && (
                <div className="arc-proc-block">
                  <span className="arc-proc-block-label">Output</span>
                  <div className={`arc-code arc-code-output ${step.type === "error" ? "is-err" : ""}`}><Code text={step.output} isOutput /></div>
                </div>
              )}
              {hasDiff && step.output && (
                <div className="arc-proc-text is-result">{step.output}</div>
              )}
              {step.runAfterCommand && (
                <div className="arc-proc-block">
                  <span className="arc-proc-block-label">Run After</span>
                  <div className="arc-code"><Code text={step.runAfterCommand} /></div>
                </div>
              )}
              {step.runAfterOutput && (
                <div className="arc-proc-block">
                  <span className="arc-proc-block-label">Output</span>
                  <div className="arc-code arc-code-output"><Code text={step.runAfterOutput} isOutput /></div>
                </div>
              )}
              {step.type === "handoff" && <HandoffBlock from={step.fromModel} to={step.toModel} reason={step.reason} />}
              {step.type === "todo_list" && step.todos && <TodoListBlock todos={step.todos} />}
              {step.type === "clarification" && <ClarificationBlock question={step.content} options={step.options} />}
              {hasChildren && step.children && (
                <div className="arc-proc-block">
                  <span className="arc-proc-block-label">Process</span>
                  <div className="arc-proc-children" style={{ marginLeft: 0, paddingLeft: 16 }}>
                    <span className="arc-proc-treeline" />
                    <StepList steps={step.children} onOpenFile={onOpenFile} onOpenFullscreenDiff={onOpenFullscreenDiff} toolTreeMode={toolTreeMode} resolvedDiffs={resolvedDiffs} onResolveDiff={onResolveDiff} />
                  </div>
                </div>
              )}
            </div>
      </Expand>
    </FadeSlideIn>
  );
});
ProcessNode.displayName = "ProcessNode";
const StepList = memo(({ steps, onOpenFile, onOpenFullscreenDiff, toolTreeMode, resolvedDiffs, onResolveDiff, groupSummaryMode, requestAISummary, saveGroupTitle }: { steps: ProcessStep[]; onOpenFile?: (path: string) => void; onOpenFullscreenDiff?: (payload: { filePath?: string; hunks: DiffHunk[] }) => void; toolTreeMode: ToolTreeMode; resolvedDiffs?: Record<string, "accepted" | "rejected">; onResolveDiff?: (step: ProcessStep, action: "accept" | "reject") => void; groupSummaryMode?: GroupSummaryMode; requestAISummary?: (groupId: string, titles: string[]) => Promise<string>; saveGroupTitle?: (stepId: string, title: string, mode: string) => void }) => {
  const isEnded = useMemo(() => steps.length > 0 && steps.every((s) => s.pending === false), [steps]);
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    if (toolTreeMode === "collapsed") return new Set<string>();
    const ids = new Set<string>();
    for (const s of steps) if (s.children?.length) ids.add(s.id);
    if (steps.length) ids.add(steps[steps.length - 1].id);
    return ids;
  });
  const [prevLen, setPrevLen] = useState(steps.length);
  const lastSigRef = useRef("");
  useEffect(() => {
    if (toolTreeMode === "collapsed") return;
    if (isEnded) {
      setOpenIds(new Set<string>());
      setPrevLen(steps.length);
      lastSigRef.current = "";
      return;
    }
    const lenChanged = steps.length > prevLen;
    const last = steps[steps.length - 1];
    const sig = last ? `${last.id}:${last.diffHunks?.length ?? 0}:${(last.output ?? "").length}` : "";
    const sigChanged = sig !== lastSigRef.current;
    if (last && (lenChanged || sigChanged)) {
      setOpenIds((prev) => {
        if (prev.has(last.id)) return prev;
        const next = new Set(prev);
        next.add(last.id);
        return next;
      });
    }
    lastSigRef.current = sig;
    setPrevLen(steps.length);
  }, [steps, prevLen, toolTreeMode, isEnded]);
  const handleToggle = useCallback((id: string) => {
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  return (
    <>
      {steps.map((step) => (
        <ProcessNode
          key={step.id}
          step={step}
          isActive={openIds.has(step.id)}
          onToggle={() => handleToggle(step.id)}
          onOpenFile={onOpenFile}
          onOpenFullscreenDiff={onOpenFullscreenDiff}
          toolTreeMode={toolTreeMode}
          resolvedDiffs={resolvedDiffs}
          onResolveDiff={onResolveDiff}
          groupSummaryMode={groupSummaryMode}
          requestAISummary={requestAISummary}
          saveGroupTitle={saveGroupTitle}
        />
      ))}
    </>
  );
});
StepList.displayName = "StepList";
export default function ArcProcessUI({ steps = [], onOpenFile, onOpenFullscreenDiff, toolTreeMode = "auto", resolvedDiffs, onResolveDiff, groupSummaryMode = "count", requestAISummary, saveGroupTitle }: { steps: ProcessStep[]; onOpenFile?: (path: string) => void; onOpenFullscreenDiff?: (payload: { filePath?: string; hunks: DiffHunk[] }) => void; toolTreeMode?: ToolTreeMode; resolvedDiffs?: Record<string, "accepted" | "rejected">; onResolveDiff?: (step: ProcessStep, action: "accept" | "reject") => void; groupSummaryMode?: GroupSummaryMode; requestAISummary?: (groupId: string, titles: string[]) => Promise<string>; saveGroupTitle?: (stepId: string, title: string, mode: string) => void }) {
  if (!steps.length) return null;
  const rendered: ProcessStep[] = steps.length > 1
    ? [{ id: `called-${steps[0].id}`, type: "tool_group", title: "Called", children: steps }]
    : steps;
  return (
    <div className="arc-proc">
      <StepList steps={rendered} onOpenFile={onOpenFile} onOpenFullscreenDiff={onOpenFullscreenDiff} toolTreeMode={toolTreeMode} resolvedDiffs={resolvedDiffs} onResolveDiff={onResolveDiff} groupSummaryMode={groupSummaryMode} requestAISummary={requestAISummary} saveGroupTitle={saveGroupTitle} />
    </div>
  );
}