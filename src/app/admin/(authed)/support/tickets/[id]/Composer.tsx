"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { Lock, Paperclip, Reply, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/admin/Button";
import { Select } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { replyAction } from "./actions";

type Mode = "reply" | "note";

/**
 * Reply to the customer (emailed + shown on their ticket page) or add an
 * internal note (staff only). Files go through staffReply → private evidence
 * storage. Ctrl/⌘+Enter sends.
 */
export function Composer({
  ticketId,
  customerContact,
  statusOptions,
  accept,
  maxFiles,
}: {
  ticketId: string;
  customerContact: string | null;
  statusOptions: { value: string; label: string }[];
  accept: string;
  maxFiles: number;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("reply");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [setStatus, setSetStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const note = mode === "note";

  function submit() {
    if (pending) return;
    if (!body.trim()) {
      setError("Write a message first.");
      return;
    }
    if (files.length > maxFiles) {
      setError(`Attach at most ${maxFiles} files.`);
      return;
    }
    // nginx and the server-action limit accept 20 MB per request.
    if (files.reduce((s, f) => s + f.size, 0) > 19 * 1024 * 1024) {
      setError("Attachments add up to more than 19 MB — send fewer or smaller files.");
      return;
    }
    const fd = new FormData();
    fd.set("ticketId", ticketId);
    fd.set("body", body);
    fd.set("internal", note ? "1" : "0");
    if (!note && setStatus) fd.set("setStatus", setStatus);
    for (const f of files) fd.append("files", f);
    setError(null);
    startTransition(async () => {
      try {
        const r = await replyAction(fd);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        toast({ title: r.message ?? "Sent", tone: "success" });
        setBody("");
        setFiles([]);
        setSetStatus("");
        if (fileRef.current) fileRef.current.value = "";
      } catch {
        // The request itself failed — most often attachments over the server's upload limit.
        setError(
          files.length
            ? "Upload failed — the files may be too large for the server. Try fewer or smaller files."
            : "Couldn't reach the server — check your connection and try again.",
        );
      }
    });
  }

  return (
    <form
      id="composer"
      className={cn("scroll-mt-20 border-t border-admin-line", note && "bg-tone-warn-bg/60")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div role="tablist" aria-label="Message type" className="flex items-center gap-6 border-b border-admin-line px-4 sm:px-5">
        <ModeTab active={!note} onClick={() => setMode("reply")} icon={<Reply size={14} aria-hidden />}>
          Reply to customer
        </ModeTab>
        <ModeTab active={note} onClick={() => setMode("note")} icon={<Lock size={14} aria-hidden />}>
          Internal note
        </ModeTab>
        <span className="ml-auto hidden truncate text-xs text-admin-muted sm:block">
          {note ? "Only staff can see this" : customerContact ? `Emailed to ${customerContact}` : "Shown on the customer's ticket page"}
        </span>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        <label htmlFor="composer-body" className="sr-only">
          {note ? "Internal note" : "Reply to customer"}
        </label>
        <textarea
          id="composer-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={5}
          maxLength={6000}
          placeholder={note ? "Note for the team — the customer never sees this." : "Write your reply…"}
          className="block min-h-28 w-full rounded-lg border border-admin-line-strong bg-white px-3 py-2 text-sm leading-5 text-brand-ink placeholder:text-admin-muted focus:border-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-red/20"
        />

        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-admin-line bg-admin-subtle py-0.5 pl-2.5 pr-1 text-xs text-brand-ink"
              >
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 tabular-nums text-admin-muted">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                  className="grid h-6 w-6 place-items-center rounded-full text-admin-muted hover:bg-white hover:text-brand-ink"
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-xs text-tone-neg">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            id="composer-files"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setFiles((all) => [...all, ...picked].slice(0, maxFiles));
              e.target.value = "";
            }}
          />
          <label
            htmlFor="composer-files"
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-brand-ink-soft hover:bg-admin-subtle hover:text-brand-ink max-md:h-11"
          >
            <Paperclip size={15} aria-hidden />
            Attach
            <span className="font-normal text-admin-muted">(photos / videos, up to {maxFiles})</span>
          </label>

          {!note && statusOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="composer-status" className="whitespace-nowrap text-xs text-admin-muted">
                Then set status
              </label>
              <Select id="composer-status" value={setStatus} onChange={(e) => setSetStatus(e.target.value)} className="min-w-40">
                <option value="">Automatic</option>
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <span className="ml-auto hidden text-xs text-admin-muted lg:inline">Ctrl + Enter to send</span>
          <Button type="submit" variant="primary" loading={pending} icon={<Send size={14} aria-hidden />} className="max-sm:w-full">
            {note ? "Add note" : "Send reply"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-11 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-colors",
        active
          ? "text-brand-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-red"
          : "text-admin-muted hover:text-brand-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
