export type ApprovalLevel = "auto" | "ask";
export type ApprovalPreset = "readonly" | "safe-edit" | "dev" | "autonomous" | "full-trust";
export interface ApprovalsConfig {
  preset?: ApprovalPreset;
  read: ApprovalLevel;
  "write.local": ApprovalLevel;
  "write.external": ApprovalLevel;
  "shell.safe": ApprovalLevel;
  "shell.other": ApprovalLevel;
  browser: ApprovalLevel;
  "web.fetch": ApprovalLevel;
  "web.search": ApprovalLevel;
  mcp: {
    default: ApprovalLevel;
    perServer: Record<string, ApprovalLevel>;
  };
}
export interface SessionApprovals {
  autoApproveAll: boolean;
  sessionCommandAllowlist: string[];
  commandPrefixMemory: { prefix: string; createdAt: string }[];
  taskOverride?: ApprovalsConfig;
}
export const PRESETS: Record<ApprovalPreset, ApprovalsConfig> = {
  "readonly": {
    read: "auto",
    "write.local": "ask",
    "write.external": "ask",
    "shell.safe": "ask",
    "shell.other": "ask",
    browser: "ask",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "ask", perServer: {} },
  },
  "safe-edit": {
    read: "auto",
    "write.local": "auto",
    "write.external": "ask",
    "shell.safe": "auto",
    "shell.other": "ask",
    browser: "ask",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "auto", perServer: {} },
  },
  "dev": {
    read: "auto",
    "write.local": "auto",
    "write.external": "ask",
    "shell.safe": "auto",
    "shell.other": "ask",
    browser: "auto",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "auto", perServer: {} },
  },
  "autonomous": {
    read: "auto",
    "write.local": "auto",
    "write.external": "auto",
    "shell.safe": "auto",
    "shell.other": "auto",
    browser: "auto",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "auto", perServer: {} },
  },
  "full-trust": {
    read: "auto",
    "write.local": "auto",
    "write.external": "auto",
    "shell.safe": "auto",
    "shell.other": "auto",
    browser: "auto",
    "web.fetch": "auto",
    "web.search": "auto",
    mcp: { default: "auto", perServer: {} },
  },
};
export const DEFAULT_APPROVALS: ApprovalsConfig = {
  read: "auto",
  "write.local": "auto",
  "write.external": "ask",
  "shell.safe": "auto",
  "shell.other": "ask",
  browser: "ask",
  "web.fetch": "auto",
  "web.search": "auto",
  mcp: { default: "auto", perServer: {} },
};
export type ApprovalCategory =
  | "read"
  | "write.local"
  | "write.external"
  | "shell.safe"
  | "shell.other"
  | "browser"
  | "web.fetch"
  | "mcp";