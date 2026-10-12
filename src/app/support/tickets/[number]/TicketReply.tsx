"use client";

import { useRef, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";
import EvidencePicker, { MAX_TOTAL_BYTES, TOTAL_TOO_BIG, totalBytes, type PickedFile } from "../../_components/EvidencePicker";
import { btnPrimary, inputClass } from "../../_components/ui";
import { replyTicketAction } from "../actions";

const MAX = 2000;

export default function TicketReply({
  number,
  token,
  accept,
  maxFiles,
  maxMb,
  awaitingCustomer,
}: {
  number: string;
  token: string | null;
  accept: string;
  maxFiles: number;
  maxMb: number;
  awaitingCustomer: boolean;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (!body.trim() && files.length === 0) {
      setError("Write a message or attach a file.");
      textRef.current?.focus();
      return;
    }
    if (totalBytes(files) > MAX_TOTAL_BYTES) {
      setError(TOTAL_TOO_BIG);
      return;
    }
    const fd = new FormData();
    fd.set("number", number);
    if (token) fd.set("k", token);
    fd.set("body", body);
    for (const f of files) fd.append("files", f.file, f.file.name);
    setError(null);
    setSent(false);
    startTransition(async () => {
      try {
        const res = await replyTicketAction(fd);
        if (res.ok) {
          setBody("");
          setFiles([]);
          setSent(true);
        } else {
          setError(res.error);
        }
      } catch {
        setError("We couldn't send that — the attachments may be too large or the connection dropped. Try fewer or smaller files.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-labelledby="reply-heading">
      <h2 id="reply-heading" className="font-display text-lg font-bold text-brand-ink">
        {awaitingCustomer ? "Reply to PRC Support" : "Add a message"}
      </h2>
      <div>
        <label htmlFor="ticket-reply" className="sr-only">
          Your message
        </label>
        <textarea
          ref={textRef}
          id="ticket-reply"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={MAX}
          placeholder={awaitingCustomer ? "Type your answer here…" : "Anything to add? New photos, details or questions…"}
          className={`${inputClass} resize-y leading-relaxed`}
        />
        <p className="mt-1 text-right text-xs text-brand-ink-soft">
          {body.length} / {MAX}
        </p>
      </div>
      <EvidencePicker
        files={files}
        onChange={setFiles}
        accept={accept}
        maxFiles={maxFiles}
        maxMb={maxMb}
        rule="NONE"
        label="Attach photos or a video"
        disabled={pending}
      />
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-brand-red">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {sent && (
        <p role="status" className="flex items-start gap-1.5 text-sm font-medium text-tone-pos">
          <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0" />
          Sent. Our team will reply here and by email.
        </p>
      )}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "Sending…" : "Send reply"}
        {!pending && <Send size={16} aria-hidden />}
      </button>
    </form>
  );
}
