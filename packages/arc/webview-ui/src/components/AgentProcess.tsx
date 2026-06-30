import { useState, useEffect, memo, useCallback } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
  ChevronRight, Bot, ArrowRight, Check, Circle, CircleDot,
  HelpCircle, CornerDownLeft, Sparkles, AlertTriangle, Terminal, ExternalLink, StopCircle,
} from "lucide-react";
type StepType =
  | "tool_group" | "tool" | "subagent" | "handoff"
  | "todo_list" | "clarification" | "thought" | "result" | "error";
interface TodoItem {
  id: string;
  text: string;
  state: "pending" | "in_progress" | "done" | "skipped" | "blocked" | "failed";
  children?: TodoItem[];
}
interface DiffHunk {
  added: boolean;
  removed: boolean;
  value: string;
}
export interface ProcessStep {
  id: string;
  type: StepType;
  title: string;
  ts?: number;
  durationMs?: number;
  pending?: boolean;
  content?: string;
  command?: string;
  output?: string;
  runAfterCommand?: string;
  runAfterOutput?: string;
  toolName?: string;
  filePath?: string;
  diffHunks?: DiffHunk[];
  fromModel?: string;
  toModel?: string;
  reason?: string;
  todos?: TodoItem[];
  options?: string[];
  children?: ProcessStep[];
  interrupted?: boolean;
}
const SPRING = { type: "spring", stiffness: 450, damping: 30 } as const;
const SPRING_BOUNCE = { type: "spring", stiffness: 420, damping: 24 } as const;
const AnimatedNumber = memo(({ value }: { value: number }) => (
  <span className="arc-proc-count">
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "-100%", opacity: 0 }}
        transition={SPRING}
      >
        {value}
      </motion.span>
    </AnimatePresence>
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
const DiffView = memo(({ hunks, filePath, onOpenFile }: { hunks: DiffHunk[]; filePath?: string; onOpenFile?: (path: string) => void }) => {
  let oldLine = 1;
  let newLine = 1;
  return (
    <div className="arc-diff">
      {filePath && (
        <div className="arc-diff-file">
          <span className="arc-diff-file-icon">+</span>
          <span className="arc-diff-file-name">{filePath}</span>
                    {onOpenFile && (
            <button className="arc-diff-file-open" title="Open file" onClick={(e) => { e.stopPropagation(); onOpenFile(filePath!); }}>
              <ExternalLink size={12} />
            </button>
          )}
          <span className="arc-diff-file-spacer" />
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
function StatusDot({ type, interrupted }: { type: StepType; interrupted?: boolean }) {
  if (interrupted) return <StopCircle className="arc-proc-dot-icon is-err" size={12} strokeWidth={2.25} />;
  if (type === "result") return <Check className="arc-proc-dot-icon is-ok" size={13} strokeWidth={2.5} />;
  if (type === "error") return <AlertTriangle className="arc-proc-dot-icon is-err" size={12} strokeWidth={2.25} />;
  if (type === "handoff") return <ArrowRight className="arc-proc-dot-icon is-accent" size={12} strokeWidth={2.25} />;
  if (type === "clarification") return <HelpCircle className="arc-proc-dot-icon is-accent" size={12} strokeWidth={2.25} />;
  if (type === "thought") return <Sparkles className="arc-proc-dot-icon is-muted" size={11} strokeWidth={2} />;
  if (type === "todo_list") return <CircleDot className="arc-proc-dot-icon is-muted" size={11} strokeWidth={2} />;
  return <span className="arc-proc-dot" />;
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
      return (
          <motion.li key={todo.id} className={`arc-proc-todo arc-proc-todo-${todo.state}`}>
          <span className="arc-proc-todo-mark">
            {done ? (
              <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING_BOUNCE} style={{ display: "inline-flex" }}>
                <Check size={13} strokeWidth={2.5} />
              </motion.span>
            ) : active ? (
              <span className="arc-proc-todo-pulse" />
            ) : skipped ? (
              <Circle size={12} />
            ) : (
              <Circle size={12} />
            )}
          </span>
          <span className="arc-proc-todo-text">{todo.text}</span>
        </motion.li>
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
      <button aria-label="Submit"><CornerDownLeft size={13} /></button>
    </div>
  </div>
));
ClarificationBlock.displayName = "ClarificationBlock";
const GroupNode = memo(({ step, onOpenFile }: { step: ProcessStep; onOpenFile?: (path: string) => void }) => {
  const [open, setOpen] = useState(step.type === "subagent");
  const childCount = step.children?.length || 0;
  return (
    <div className="arc-proc-group">
      <button className="arc-proc-group-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="arc-proc-group-icon-wrap">
          <ChevronRight size={14} className="arc-proc-group-icon-chevron" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} />
          {step.type === "subagent" ? <Bot size={14} className="arc-proc-group-icon is-accent" /> : <Terminal size={13} className="arc-proc-group-icon" />}
        </span>
        <span className="arc-proc-group-title">{step.title || "Called"}</span>
        {step.type === "tool_group" && (
          <span className="arc-proc-group-meta">
            <AnimatedNumber value={childCount} /> {childCount === 1 ? "tool" : "tools"}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && step.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="arc-proc-children-wrap"
          >
            <div className="arc-proc-children">
              <span className="arc-proc-treeline" />
              <StepList steps={step.children} onOpenFile={onOpenFile} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
    <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={SPRING} className="arc-proc-node arc-proc-node-thought">
      <button
        className="arc-proc-row"
        onClick={() => hasContent && setOpen((o) => !o)}
        disabled={!hasContent}
        aria-expanded={hasContent ? showBody : undefined}
      >
        <span className="arc-proc-row-mark"><StatusDot type="thought" interrupted={step.interrupted} /></span>
        <span className="arc-proc-title arc-proc-title-thought">
          {step.pending ? <>Thinking<span className="arc-working-dots" /></> : `Thought for ${secs} seconds`}
        </span>
        {hasContent && !step.pending && (
          <motion.span className="arc-proc-chevron" animate={{ rotate: open ? 90 : 0 }} transition={SPRING}>
            <ChevronRight size={13} />
          </motion.span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {showBody && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING} className="arc-proc-children-wrap">
            <div className="arc-proc-children">
              <span className="arc-proc-treeline" />
              <div className="arc-proc-text is-thought">{step.content}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
ThoughtNode.displayName = "ThoughtNode";
const ProcessNode = memo(({ step, isActive, onToggle, onOpenFile }: { step: ProcessStep; isActive: boolean; onToggle: () => void; onOpenFile?: (path: string) => void }) => {
  if (step.type === "tool_group") return <GroupNode step={step} onOpenFile={onOpenFile} />;
  if (step.type === "subagent") return <GroupNode step={step} onOpenFile={onOpenFile} />;
  if (step.type === "thought") return <ThoughtNode step={step} />;
  const isReadTool = step.toolName === "file.read";
  const isNoDetail = isReadTool || step.toolName === "web.fetch";
  const isWriteTool = step.toolName === "file.write";
  const isEditTool = step.toolName === "file.edit";
  const hasDiff = isWriteTool || isEditTool;
  const hasChildren = !!step.children?.length;
  const hasDetails = hasChildren || (!isNoDetail && (!!step.command || !!step.output || !!step.content || !!step.todos || !!step.options || !!step.runAfterCommand || !!step.runAfterOutput || step.type === "handoff" || (hasDiff && !!step.diffHunks?.length)));
  return (
    <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={SPRING} className={`arc-proc-node arc-proc-node-${step.type}`}>
      <button
        className="arc-proc-row"
        onClick={() => hasDetails && onToggle()}
        disabled={!hasDetails}
        aria-expanded={hasDetails ? isActive : undefined}
      >
        <span className="arc-proc-row-mark"><StatusDot type={step.type} interrupted={step.interrupted} /></span>
        <span className="arc-proc-title">{step.title}{step.interrupted ? <span className="arc-proc-interrupted">(stopped)</span> : null}</span>
        {hasDetails && (
          <motion.span className="arc-proc-chevron" animate={{ rotate: isActive ? 90 : 0 }} transition={SPRING}>
            <ChevronRight size={13} />
          </motion.span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {isActive && hasDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="arc-proc-detail-wrap"
          >
            <div className="arc-proc-detail">
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
              {hasDiff && step.diffHunks && step.diffHunks.length > 0 && (
                <div className="arc-proc-block">
                  <span className="arc-proc-block-label">Diff</span>
                   <DiffView hunks={step.diffHunks} filePath={step.filePath} onOpenFile={onOpenFile} />
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
                    <StepList steps={step.children} onOpenFile={onOpenFile} />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
ProcessNode.displayName = "ProcessNode";
const StepList = memo(({ steps, onOpenFile }: { steps: ProcessStep[]; onOpenFile?: (path: string) => void }) => {
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    if (steps.length) ids.add(steps[steps.length - 1].id);
    for (const s of steps) if (s.children?.length) ids.add(s.id);
    return ids;
  });
  const [prevLen, setPrevLen] = useState(steps.length);
  useEffect(() => {
    if (steps.length > prevLen && steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      setOpenIds((cur) => {
        const next = new Set(cur);
        next.add(lastStep.id);
        for (const s of steps) if (s.children?.length) next.add(s.id);
        return next;
      });
    }
    setPrevLen(steps.length);
  }, [steps, prevLen]);
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
        />
      ))}
    </>
  );
});
StepList.displayName = "StepList";
export default function ArcProcessUI({ steps = [], onOpenFile }: { steps: ProcessStep[]; onOpenFile?: (path: string) => void }) {
  if (!steps.length) return null;
  const rendered: ProcessStep[] = steps.length > 1
    ? [{ id: `called-${steps[0].id}`, type: "tool_group", title: "Called", children: steps }]
    : steps;
  return (
    <div className="arc-proc">
      <LayoutGroup>
        <StepList steps={rendered} onOpenFile={onOpenFile} />
      </LayoutGroup>
    </div>
  );
}