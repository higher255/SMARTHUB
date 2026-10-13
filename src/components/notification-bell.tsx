import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, CheckCheck } from "lucide-react";
import { listNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification } from "@/lib/ehs/server";
import { useLive } from "@/lib/ui/use-live";
import { timeAgo } from "@/lib/ui/format";

/** In-app notifications, refreshed every 15 seconds so approvals reach people without a reload. */
export function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listNotifications());
    } catch {
      /* transient network error: keep what we have */
    }
  }, []);
  useLive(load, 15000);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const unread = items.filter((n) => !n.read_at).length;

  const readAll = async () => {
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    await markAllNotificationsRead().catch(() => undefined);
  };

  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read_at) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      await markNotificationRead({ data: n.id }).catch(() => undefined);
    }
    if (n.link) void navigate({ to: n.link });
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-lg border border-border text-fg-muted transition hover:bg-bg-subtle hover:text-fg"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 ? (
              <button type="button" onClick={() => void readAll()} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-fg-muted">You are all caught up.</li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(n)}
                    className={`flex w-full gap-3 border-b border-border/60 px-4 py-3 text-left transition hover:bg-bg-subtle ${n.read_at ? "" : "bg-accent/5"}`}
                  >
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-accent"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{n.message}</span>
                      <span className="mt-1 block text-[11px] text-fg-subtle">{timeAgo(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
