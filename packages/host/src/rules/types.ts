export interface RuleEntry {
  name: string;
  glob?: string;
  description: string;
  body: string;
  scope: "workspace" | "global";
}