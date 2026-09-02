export type ApprovalLevel = "auto" | "ask";
export type ApprovalPreset = "readonly" | "safe-edit" | "dev" | "autonomous" | "full-trust";
export interface ApprovalsConfig {
  preset?: ApprovalPreset;
  read: ApprovalLevel;
  "read.external": ApprovalLevel;
  "write.local": ApprovalLevel;
  "write.external": ApprovalLevel;
  "shell.safe": ApprovalLevel;
  "shell.other": ApprovalLevel;
  browser: ApprovalLevel;
  "code.execute": ApprovalLevel;
  subagent: ApprovalLevel;
  "web.fetch": ApprovalLevel;
  "web.search": ApprovalLevel;
  mcp: {
    default: ApprovalLevel;
    perServer: Record<string, ApprovalLevel>;
  };
}
export type AutoApproveLevel = "safe" | "allowlist" | "all";
export interface SessionApprovals {
  autoApproveMode: "off" | AutoApproveLevel;
  sessionCommandAllowlist: string[];
  commandPrefixMemory: { prefix: string; createdAt: string }[];
  taskOverride?: ApprovalsConfig;
}
export const PRESETS: Record<ApprovalPreset, ApprovalsConfig> = {
  "readonly": {
    read: "auto",
    "read.external": "ask",
    "write.local": "ask",
    "write.external": "ask",
    "shell.safe": "ask",
    "shell.other": "ask",
    browser: "ask",
    "code.execute": "ask",
    subagent: "ask",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "ask", perServer: {} },
  },
  "safe-edit": {
    read: "auto",
    "read.external": "ask",
    "write.local": "auto",
    "write.external": "ask",
    "shell.safe": "auto",
    "shell.other": "ask",
    browser: "ask",
    "code.execute": "ask",
    subagent: "ask",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "auto", perServer: {} },
  },
  "dev": {
    read: "auto",
    "read.external": "ask",
    "write.local": "auto",
    "write.external": "ask",
    "shell.safe": "auto",
    "shell.other": "ask",
    browser: "auto",
    "code.execute": "ask",
    subagent: "ask",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "auto", perServer: {} },
  },
  "autonomous": {
    read: "auto",
    "read.external": "ask",
    "write.local": "auto",
    "write.external": "auto",
    "shell.safe": "auto",
    "shell.other": "auto",
    browser: "auto",
    "code.execute": "ask",
    subagent: "ask",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "auto", perServer: {} },
  },
  "full-trust": {
    read: "auto",
    "read.external": "ask",
    "write.local": "auto",
    "write.external": "auto",
    "shell.safe": "auto",
    "shell.other": "auto",
    browser: "auto",
    "code.execute": "ask",
    subagent: "ask",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "auto", perServer: {} },
  },
};
export const DEFAULT_APPROVALS: ApprovalsConfig = {
  read: "auto",
  "read.external": "ask",
  "write.local": "auto",
  "write.external": "ask",
  "shell.safe": "auto",
  "shell.other": "ask",
  browser: "ask",
  "code.execute": "ask",
  subagent: "ask",
  "web.fetch": "auto",
  "web.search": "auto",
  mcp: { default: "auto", perServer: {} },
};
export interface ApproveShellMeta {
  command?: string;
}
export type ApprovalCategory =
  | "read"
  | "read.external"
  | "write.local"
  | "write.external"
  | "shell.safe"
  | "shell.other"
  | "browser"
  | "code.execute"
  | "subagent"
  | "web.fetch"
  | "mcp";