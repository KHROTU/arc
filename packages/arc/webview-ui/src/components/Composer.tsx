import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
type Attachment = { uri: string; preview?: string };
type Props = {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop?: () => void;
  onGuidance?: (text: string) => void;
  streaming?: boolean;
  disabled?: boolean;
  pendingAttachment?: string | null;
  onAttach?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  queuedText?: string | null;
  onCancelQueue?: () => void;
};
export default function Composer({
  onSend, onStop, onGuidance, streaming, disabled, pendingAttachment, onAttach, placeholder, autoFocus = true, queuedText, onCancelQueue,
}: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);
  useEffect(() => {
    if (pendingAttachment) {
      setAttachments((prev) => [
        ...prev.filter((a) => a.preview !== pendingAttachment),
        { uri: pendingAttachment, preview: pendingAttachment },
      ]);
    }
  }, [pendingAttachment]);
  const submit = useCallback(() => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t, attachments.length ? attachments : undefined);
    setText("");
    setAttachments([]);
  }, [text, disabled, streaming, attachments, onSend]);
  const attach = () => {
    if (onAttach) return onAttach();
    (window as unknown as { __ARC_ATTACH?: () => void }).__ARC_ATTACH?.();
  };
  if (queuedText) {
    return (
      <div className="arc-composer is-queued">
        <div className="arc-composer-queued">
          <span className="arc-composer-queued-label">Queued message:</span>
          <span className="arc-composer-queued-text">{queuedText}</span>
          <button className="arc-composer-send is-stop" onClick={onCancelQueue} title="Cancel queued message">
            <X size={12} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`arc-composer ${disabled ? "is-disabled" : ""} ${streaming ? "is-busy" : ""}`}>
      {attachments.length > 0 && (
        <div className="arc-composer-attachments">
          {attachments.map((a) => (
            <span key={a.uri} className="arc-attach-pill" title={a.uri}>
              <Paperclip size={11} />
              <span className="arc-attach-pill-text">{a.preview ?? a.uri}</span>
              <button className="arc-attach-pill-x" onClick={() => setAttachments((p) => p.filter((x) => x.uri !== a.uri))} aria-label="Remove">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey && onGuidance) {
            e.preventDefault();
            const t = text.trim();
            if (t) { onGuidance(t); setText(""); }
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault(); submit();
          }
        }}
        rows={1}
        disabled={disabled}
        placeholder={placeholder ?? "Ask Arc anything…"}
      />
      <div className="arc-composer-bar">
        <button className="arc-composer-tool" title="Attach editor selection" onClick={attach} disabled={disabled}>
          <Paperclip size={14} />
        </button>
        <span className="arc-composer-hint">⏎ send · ⇧⏎ newline · ⌃⏎ guide</span>
        <span className="arc-spacer" />
        {streaming ? (
          <button className="arc-composer-send is-stop" onClick={onStop} title="Stop">
            <Square size={12} strokeWidth={2.5} />
          </button>
        ) : (
          <button className="arc-composer-send" onClick={submit} disabled={disabled || !text.trim()} title="Send (Enter)">
            <ArrowUp size={15} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}