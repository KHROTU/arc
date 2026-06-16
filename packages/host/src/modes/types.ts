export interface Mode {
  slug: string;
  roleDefinition: string;
  allowedTools: string[];
  writeGlob?: string;
  description: string;
  whenToUse: string;
}
export type ModeSource = "builtin" | "workspace" | "global";