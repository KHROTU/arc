export type ApprovalLevel = "auto" | "ask";
export interface ApprovalsConfig {
  read: ApprovalLevel;
  "write.local": ApprovalLevel;
  "write.external": ApprovalLevel;
  "shell.safe": ApprovalLevel;
  "shell.other": ApprovalLevel;
  browser: ApprovalLevel;
  webfetch: ApprovalLevel;
  mcp: {
    default: ApprovalLevel;
    perServer: Record<string, ApprovalLevel>;
  };
}
export interface SessionApprovals {
  autoApproveAll: boolean;
  sessionCommandAllowlist: string[];
  commandPrefixMemory: { prefix: string; createdAt: string }[];
}
export const DEFAULT_APPROVALS: ApprovalsConfig = {
  read: "auto",
  "write.local": "auto",
  "write.external": "ask",
  "shell.safe": "auto",
  "shell.other": "ask",
  browser: "ask",
  webfetch: "ask",
  mcp: { default: "ask", perServer: {} },
};
export type ApprovalCategory =
  | "read"
  | "write.local"
  | "write.external"
  | "shell.safe"
  | "shell.other"
  | "browser"
  | "webfetch"
  | "mcp";