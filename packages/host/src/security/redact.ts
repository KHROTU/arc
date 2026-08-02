export function redactSecrets(text: string, secrets: (string | undefined)[] = []): string {
  let redacted = text.slice(0, 4096);
  for (const secret of secrets) {
    if (secret && secret.length >= 6) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|sk-proj|sk-ant|ghp|github_pat)-?[_A-Za-z0-9-]{16,}\b/g, "[REDACTED]");
}