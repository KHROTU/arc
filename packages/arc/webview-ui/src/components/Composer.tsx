import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { ArrowUp, Paperclip, Square, X, ChevronDown } from "./icons";
type Attachment = { uri: string; preview?: string };
type Props = {
  onSend: (text: string, attachments?: Attachment[], images?: string[]) => void;
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
  prefillText?: string | null;
};
export default function Composer({
  onSend, onStop, onGuidance, streaming, disabled, pendingAttachment, onAttach, placeholder, autoFocus = true, queuedText, onCancelQueue, prefillText,
}: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useLayoutEffect(() => {
    if (prefillText !== undefined && prefillText !== null) {
      setText(prefillText);
      ref.current?.focus();
    }
  }, [prefillText]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);
  useEffect(() => {
    if (!actionsOpen) return;
    const handler = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [actionsOpen]);
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
    onSend(t, attachments.length ? attachments : undefined, images.length ? images : undefined);
    setText("");
    setAttachments([]);
    setImages([]);
  }, [text, disabled, streaming, attachments, onSend]);
  const attach = () => {
    if (onAttach) return onAttach();
    (window as unknown as { __ARC_ATTACH?: () => void }).__ARC_ATTACH?.();
  };
  const attachFile = () => {
    (window as unknown as { __ARC_ATTACH_FILE?: () => void }).__ARC_ATTACH_FILE?.();
  };
  const attachProblems = () => {
    (window as unknown as { __ARC_ATTACH_PROBLEMS?: () => void }).__ARC_ATTACH_PROBLEMS?.();
  };
  const attachAllProblems = () => {
    (window as unknown as { __ARC_ATTACH_ALL_PROBLEMS?: () => void }).__ARC_ATTACH_ALL_PROBLEMS?.();
  };
  const attachFileProblems = () => {
    (window as unknown as { __ARC_ATTACH_FILE_PROBLEMS?: () => void }).__ARC_ATTACH_FILE_PROBLEMS?.();
  };
  const attachCurrentFile = () => {
    (window as unknown as { __ARC_ATTACH_CURRENT_FILE?: () => void }).__ARC_ATTACH_CURRENT_FILE?.();
  };
  const attachGitDiff = () => {
    (window as unknown as { __ARC_ATTACH_GIT_DIFF?: () => void }).__ARC_ATTACH_GIT_DIFF?.();
  };
  const attachGitStaged = () => {
    (window as unknown as { __ARC_ATTACH_GIT_STAGED?: () => void }).__ARC_ATTACH_GIT_STAGED?.();
  };
  const attachChangedFiles = () => {
    (window as unknown as { __ARC_ATTACH_CHANGED_FILES?: () => void }).__ARC_ATTACH_CHANGED_FILES?.();
  };
  const attachPullRequest = () => {
    (window as unknown as { __ARC_ATTACH_PR?: () => void }).__ARC_ATTACH_PR?.();
  };
  const [attachOpen, setAttachOpen] = useState(false);
  const attachRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (attachRef.current && !attachRef.current.contains(e.target as Node)) setAttachOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
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
            <span key={a.uri} className="arc-attach-pill">
              <Paperclip size={11} />
              <span className="arc-attach-pill-text">{a.preview ?? a.uri}</span>
              <button className="arc-attach-pill-x" onClick={() => setAttachments((p) => p.filter((x) => x.uri !== a.uri))} aria-label="Remove">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="arc-composer-images">
          {images.map((dataUrl, i) => (
            <span key={i} className="arc-image-chip">
              <img src={dataUrl} alt={`Pasted ${i + 1}`} onClick={() => setEnlarged(dataUrl)} />
              <button
                className="arc-image-chip-x"
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
              ><X size={14} /></button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith("image/")) {
              const blob = items[i].getAsFile();
              if (!blob) continue;
              const reader = new FileReader();
              reader.onload = () => setImages((prev) => [...prev, reader.result as string]);
              reader.readAsDataURL(blob);
              e.preventDefault();
            }
          }
        }}
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
        <div className="arc-attach-wrap" ref={attachRef}>
          <button className="arc-composer-tool" title="Attach" onClick={() => setAttachOpen((o) => !o)} disabled={disabled}>
            <Paperclip size={14} />
          </button>
          {attachOpen && (
            <div className="arc-attach-dropdown">
              <button className="arc-attach-item" onClick={() => { attach(); setAttachOpen(false); }}>Attach selection</button>
              <div className="arc-attach-parent">
                <button className="arc-attach-item arc-attach-has-sub" onClick={() => setAttachOpen(false)}>Attach file</button>
                <div className="arc-attach-submenu">
                  <button className="arc-attach-item" onClick={() => { attachCurrentFile(); setAttachOpen(false); }}>Current file</button>
                  <button className="arc-attach-item" onClick={() => { attachFile(); setAttachOpen(false); }}>Select…</button>
                </div>
              </div>
              <div className="arc-attach-parent">
                <button className="arc-attach-item arc-attach-has-sub" onClick={() => setAttachOpen(false)}>Attach problems</button>
                <div className="arc-attach-submenu">
                  <button className="arc-attach-item" onClick={() => { attachProblems(); setAttachOpen(false); }}>Current file</button>
                  <button className="arc-attach-item" onClick={() => { attachAllProblems(); setAttachOpen(false); }}>All files</button>
                  <button className="arc-attach-item" onClick={() => { attachFileProblems(); setAttachOpen(false); }}>Select…</button>
                </div>
              </div>
              <div className="arc-attach-parent">
                <button className="arc-attach-item arc-attach-has-sub" onClick={() => setAttachOpen(false)}>Attach from Git</button>
                <div className="arc-attach-submenu">
                  <button className="arc-attach-item" onClick={() => { attachGitDiff(); setAttachOpen(false); }}>Unstaged diff</button>
                  <button className="arc-attach-item" onClick={() => { attachGitStaged(); setAttachOpen(false); }}>Staged diff</button>
                  <button className="arc-attach-item" onClick={() => { attachChangedFiles(); setAttachOpen(false); }}>Changed files</button>
                  <div className="arc-attach-sep" />
                  <div className="arc-attach-parent">
                    <button className="arc-attach-item arc-attach-has-sub" onClick={() => setAttachOpen(false)}>Pull request</button>
                    <div className="arc-attach-submenu">
                      <button className="arc-attach-item" onClick={() => { attachPullRequest(); setAttachOpen(false); }}>Current branch</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <span className="arc-spacer" />
        {streaming ? (
          <div className="arc-send-group" ref={actionsRef}>
            {text.trim() ? (
              <button className="arc-composer-send" onClick={submit} title="Send (queues after current turn)">
                <ArrowUp size={15} strokeWidth={2.5} />
              </button>
            ) : (
              <button className="arc-composer-send is-stop" onClick={onStop} title="Stop">
                <Square size={12} strokeWidth={2.5} />
              </button>
            )}
            <span className="arc-send-sep" />
            <button className="arc-composer-send is-chevron" onClick={() => setActionsOpen((o) => !o)} title="More actions">
              <ChevronDown size={12} strokeWidth={2.5} />
            </button>
            {actionsOpen && (
              <div className="arc-send-dropdown">
                <button className="arc-send-dropdown-item" onClick={() => { setActionsOpen(false); if (text.trim() && onGuidance) { onGuidance(text.trim()); setText(""); } }} disabled={!text.trim()}>
                  Steer
                </button>
                <button className="arc-send-dropdown-item" onClick={() => { setActionsOpen(false); if (text.trim()) { onSend(text.trim(), attachments.length ? attachments : undefined, images.length ? images : undefined); setText(""); setAttachments([]); setImages([]); } }} disabled={!text.trim()}>
                  Queue
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="arc-composer-send" onClick={submit} disabled={disabled || !text.trim()} title="Send (Enter)">
            <ArrowUp size={15} strokeWidth={2.5} />
          </button>
        )}
      </div>
      {enlarged && (
        <div className="arc-image-overlay" onClick={() => setEnlarged(null)}>
          <img src={enlarged} alt="Enlarged" />
        </div>
      )}
    </div>
  );
}