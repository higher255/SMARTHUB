import { useEffect, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Inbox, XCircle, X, Info } from "lucide-react";

export type Tone = "ok" | "warn" | "danger" | "info";

export function toneOf(message: string): Tone {
  if (/\b(fail|failed|error|could not|cannot|can't|denied|unable|invalid|not found|rejected|suspended)\b/i.test(message)) return "danger";
  if (/\b(please|required|select|choose|fill|enter|provide|missing)\b/i.test(message)) return "warn";
  return "ok";
}

const TONE_STYLES: Record<Tone, string> = {
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-border bg-bg-subtle text-fg-muted",
};

function ToneIcon({ tone, className = "size-4" }: { tone: Tone; className?: string }) {
  if (tone === "ok") return <CheckCircle2 className={className} />;
  if (tone === "warn") return <AlertTriangle className={className} />;
  if (tone === "danger") return <XCircle className={className} />;
  return <Info className={className} />;
}

/** Inline status message. Tone is inferred from the text unless given. */
export function Notice({ msg, tone, onClose }: { msg: string | null | undefined; tone?: Tone; onClose?: () => void }) {
  if (!msg) return null;
  const t = tone ?? toneOf(msg);
  return (
    <div role="status" className={`mb-4 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${TONE_STYLES[t]}`}>
      <ToneIcon tone={t} className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">{msg}</p>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="rounded p-0.5 opacity-70 hover:opacity-100">
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

const BADGE: Record<string, string> = {
  Draft: "bg-bg-subtle text-fg-muted", Submitted: "bg-accent/10 text-accent", "Under Review": "bg-warn/15 text-warn",
  Approved: "bg-ok/15 text-ok", Rejected: "bg-danger/15 text-danger", Paid: "bg-ok/15 text-ok", Cancelled: "bg-bg-subtle text-fg-subtle",
  Issued: "bg-accent/10 text-accent", "Partially Paid": "bg-warn/15 text-warn", Void: "bg-bg-subtle text-fg-subtle",
  Open: "bg-danger/10 text-danger", "In Progress": "bg-warn/15 text-warn", Closed: "bg-ok/15 text-ok",
  Minor: "bg-bg-subtle text-fg-muted", Major: "bg-warn/15 text-warn", Critical: "bg-danger/15 text-danger",
  Pending: "bg-warn/15 text-warn", Expired: "bg-danger/15 text-danger", Controlled: "bg-ok/15 text-ok",
  Healthy: "bg-ok/15 text-ok", Watch: "bg-warn/15 text-warn", "Stop-work risk": "bg-danger/15 text-danger",
  Active: "bg-ok/15 text-ok", Suspended: "bg-danger/15 text-danger",
  Overdue: "bg-danger/15 text-danger", "Due soon": "bg-warn/15 text-warn", "No fee": "bg-bg-subtle text-fg-muted", active: "bg-ok/15 text-ok", suspended: "bg-danger/15 text-danger",
  Low: "bg-bg-subtle text-fg-muted", Medium: "bg-warn/15 text-warn", High: "bg-danger/10 text-danger",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[status] ?? "bg-bg-subtle text-fg-muted"}`}>{status}</span>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-full bg-bg-subtle text-fg-subtle"><Inbox className="size-5" /></span>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-xs text-fg-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-bg-elevated shadow-xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg-elevated px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-fg-muted hover:bg-bg-subtle"><X className="size-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export type TabDef<T extends string> = { id: T; label: string; icon?: ReactNode; badge?: number };

export function TabBar<T extends string>({ tabs, active, onChange }: { tabs: TabDef<T>[]; active: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            active === t.id ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg"
          }`}
        >
          {t.icon}
          {t.label}
          {t.badge ? <span className="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-fg";
  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}

export const inputCls =
  "w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none transition focus:border-accent-bright focus:ring-2 focus:ring-accent/30 disabled:opacity-60";
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent-bright active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-md border border-border-strong px-3.5 py-2 text-sm font-medium text-fg transition hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-60";
export const btnDanger =
  "inline-flex items-center justify-center gap-2 rounded-md border border-danger/40 px-3.5 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60";
