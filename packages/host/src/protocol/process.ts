export type StepType =
  | "tool_group"
  | "tool"
  | "subagent"
  | "handoff"
  | "todo_list"
  | "clarification"
  | "thought"
  | "result"
  | "error";
export interface TodoItem {
  id: string;
  text: string;
  state: "pending" | "in_progress" | "done" | "skipped";
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
  fromModel?: string;
  toModel?: string;
  reason?: string;
  todos?: TodoItem[];
  options?: string[];
  children?: ProcessStep[];
}