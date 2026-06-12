import React, { useState } from "react";
import ArcProcessUI, { type ProcessStep } from "./AgentProcess";
import { motion } from "framer-motion";
import { Settings2, Maximize2, ArrowRight, X } from "lucide-react";
import Composer from "./Composer";
import McpPanel from "./McpPanel";
import ModelsPanel from "./ModelsPanel";
import { createClient, type RpcClient } from "../rpc";
import { useArcLogo, swapOnError } from "../hooks/useArcLogo";
export default function Playground({ monoLogo, prideLogo, prideActive }: { monoLogo: string; prideLogo: string; prideActive: boolean }) {
  const logoUri = useArcLogo(monoLogo, prideLogo, prideActive);
  const [client] = useState<RpcClient>(() => createClient());
  return (
    <div className="arc-playground">
      <div className="arc-playground-title">
        <img className="arc-mark" src={logoUri} alt="Arc" style={{ width: 22, height: 22 }} onError={swapOnError(monoLogo)} />
        <h1>Arc — Component Playground</h1>
      </div>
      <p className="arc-playground-sub">Every component, every state. Iterate against this.</p>
      <Group title="Tier pills">
        {(["free", "light", "default", "heavy"] as const).map((t) => (
          <Card key={t} label={t}><span className={`arc-tier arc-tier-${t}`}>{t}</span></Card>
        ))}
      </Group>
      <Group title="Top bar">
        <div className="arc-playground-card arc-playground-wide">
          <header className="arc-topbar" style={{ borderBottom: "none" }}>
            <img className="arc-mark" src={logoUri} alt="Arc" onError={swapOnError(monoLogo)} />
            <div className="arc-model">
              <select className="arc-modelpicker"><option>claude-3-5-sonnet</option><option>o1</option></select>
              <span className="arc-tier arc-tier-default">default</span>
            </div>
            <span className="arc-topbar-spacer" />
            <span className="arc-ctx" title="42%"><span className="arc-ctx-track"><span className="arc-ctx-fill" style={{ width: "42%" }} /></span><span className="arc-ctx-pct">42%</span></span>
            <span className="arc-topbar-cost">$0.184</span>
            <span className="arc-topbar-sep" />
            <button className="arc-iconbtn"><Maximize2 size={14} /></button>
            <button className="arc-iconbtn"><Settings2 size={15} /></button>
          </header>
        </div>
      </Group>
      <Group title="Composer">
        <Card label="idle"><Composer onSend={() => {}} autoFocus={false} /></Card>
        <Card label="streaming"><Composer onSend={() => {}} streaming onStop={() => {}} autoFocus={false} /></Card>
        <Card label="disabled"><Composer onSend={() => {}} disabled autoFocus={false} /></Card>
        <Card label="with attachment"><Composer onSend={() => {}} pendingAttachment="src/auth.ts:12-40" autoFocus={false} /></Card>
      </Group>
      <Group title="Handoff banner">
        <div className="arc-playground-card arc-playground-wide">
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="arc-handoff-banner">
            <span className="arc-handoff-from">default</span>
            <ArrowRight size={12} />
            <span className="arc-handoff-to">heavy</span>
            <span className="arc-handoff-reason">intermittent state-dependent corruption during GC</span>
          </motion.div>
        </div>
      </Group>
      <Group title="Clarification">
        <div className="arc-playground-card arc-playground-wide">
          <div className="arc-clarification">
            <div className="arc-clarification-q">Which file should I edit?</div>
            <div className="arc-clarification-options">
              <button className="arc-chip">src/auth.ts</button>
              <button className="arc-chip">src/auth.test.ts</button>
              <button className="arc-chip">Both</button>
            </div>
          </div>
        </div>
      </Group>
      <Group title="Error toast">
        <div className="arc-playground-card arc-playground-wide">
          <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="arc-errorbar">
            <X size={13} /> <span>Provider OpenAI returned 401: invalid api key</span>
          </motion.div>
        </div>
      </Group>
      <Group title="Onboarding">
        <div className="arc-playground-card arc-playground-wide">
          <div className="arc-onboarding">
            <img className="arc-onboarding-mark" src={logoUri} alt="Arc" onError={swapOnError(monoLogo)} />
            <h2>Welcome to Arc</h2>
            <p>Arc picks the right model per subtask, hands hard problems to heavier models, and brings you back when it's done.</p>
            <ol className="arc-onboarding-steps">
              <li><span className="arc-onboarding-num">1</span> Add a <strong>provider</strong> and bind a <strong>model</strong>.</li>
              <li><span className="arc-onboarding-num">2</span> Pick your model in the top bar.</li>
              <li><span className="arc-onboarding-num">3</span> Describe a task below.</li>
            </ol>
            <button className="arc-btn"><Settings2 size={14} /> Open settings</button>
          </div>
        </div>
      </Group>
      <Group title="Panels (Models · MCP)">
        <div className="arc-playground-card arc-playground-flush">
          <ModelsPanel client={client} models={[
            { id: "m1", label: "Claude 3.5 Sonnet", tier: "default", contextWindow: 200000, costPer1mIn: 3, costPer1mOut: 15, providers: [] },
            { id: "m2", label: "o1", tier: "heavy", contextWindow: 200000, costPer1mIn: 15, costPer1mOut: 60, providers: [] },
          ]} onClose={() => {}} />
        </div>
        <div className="arc-playground-card arc-playground-flush">
          <McpPanel client={client} onClose={() => {}} />
        </div>
      </Group>
      <Group title="Process timeline — the north star">
        <div className="arc-playground-card arc-playground-wide arc-playground-transcript">
          <ArcProcessUI steps={SAMPLE_STEPS} />
        </div>
      </Group>
    </div>
  );
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h2 className="arc-playground-h2">{title}</h2>
      <div className="arc-playground-grid">{children}</div>
    </>
  );
}
function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="arc-playground-card">
      <div className="arc-playground-card-title">{label}</div>
      {children}
    </div>
  );
}
const SAMPLE_STEPS: ProcessStep[] = [
  { id: "t1", type: "thought", title: "Thought for 1.2s", content: "I should read the test file first, add a regression test, then implement retry with exponential backoff." },
  { id: "td1", type: "todo_list", title: "Plan", todos: [
    { id: "1", text: "Read existing tests", state: "done" },
    { id: "2", text: "Implement retry logic", state: "in_progress" },
    { id: "3", text: "Add a regression test", state: "pending" },
    { id: "4", text: "Drop the legacy shim", state: "skipped" },
  ] },
  { id: "g1", type: "tool_group", title: "Called", children: [
    { id: "t2", type: "tool", title: "Read src/auth.ts", command: "read src/auth.ts", output: "export async function login(user, pass) {\n  // ...\n}" },
    { id: "t3", type: "tool", title: "Ran git status", command: "git status --short", output: "{\"stdout\": \" M src/auth.ts\", \"stderr\": \"\", \"interrupted\": false}" },
  ] },
  { id: "h1", type: "handoff", title: "Handoff to heavy", fromModel: "default", toModel: "heavy", reason: "race condition only reproduces under load" },
  { id: "g2", type: "subagent", title: "test-writer", children: [
    { id: "t4", type: "tool", title: "Wrote src/auth.test.ts", command: "write src/auth.test.ts (820 chars)" },
  ] },
  { id: "t5", type: "clarification", title: "Asked: retry policy?", content: "Should the retry policy be exponential with jitter, or constant?", options: ["Exponential + jitter", "Constant 100ms", "No retry"] },
  { id: "t6", type: "error", title: "Tool error: lsp.definition", output: "Error: lsp.definition not available for this language server" },
  { id: "t7", type: "result", title: "Done", content: "Implemented retry with exponential backoff and added a regression test. Diagnostics clean." },
];