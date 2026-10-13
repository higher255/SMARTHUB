import { useMemo, useState } from "react";
import { Modal, Notice, btnGhost, btnPrimary } from "@/components/ui-kit";
import { ALL_PERMISSIONS, PERMISSION_LABELS, ROLE_PERMISSIONS, type Permission } from "@/lib/ehs/access";
import { ROLE_LABELS, type EhsRole } from "@/lib/ehs/roles";
import { setUserPermissions } from "@/lib/ehs/server";
import { errorMessage } from "@/lib/ui/use-live";

/** Grant extra permissions on top of a user's role, e.g. a Project Manager who may also approve finance requests. */
export function PermissionsDialog({ user, onClose, onSaved }: { user: { userId: string; fullName: string; baseRole: string; permissions: string[] }; onClose: () => void; onSaved: () => void }) {
  const base = useMemo(() => new Set<string>(ROLE_PERMISSIONS[user.baseRole as EhsRole] ?? []), [user.baseRole]);
  const [extra, setExtra] = useState<Set<string>>(new Set(user.permissions.filter((p) => !base.has(p))));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (p: string) => setExtra((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  return (
    <Modal title={`Access for ${user.fullName}`} onClose={onClose} wide>
      <Notice msg={err} tone="danger" />
      <p className="mb-4 text-sm text-fg-muted">
        Role: <span className="font-medium text-fg">{ROLE_LABELS[user.baseRole as EhsRole] ?? user.baseRole}</span>. Permissions marked "role" come with the role. Tick extra ones to give this person more without changing their role or login.
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {ALL_PERMISSIONS.map((p: Permission) => {
          const fromRole = base.has(p);
          return (
            <li key={p}>
              <label className={`flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm ${fromRole ? "opacity-60" : "hover:bg-bg-subtle"}`}>
                <input type="checkbox" className="mt-0.5" disabled={fromRole} checked={fromRole || extra.has(p)} onChange={() => toggle(p)} />
                <span>{PERMISSION_LABELS[p]}{fromRole ? <span className="ml-1.5 text-[11px] text-fg-subtle">role</span> : null}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button
          type="button"
          disabled={busy}
          className={btnPrimary}
          onClick={async () => {
            setBusy(true);
            try { await setUserPermissions({ data: { userId: user.userId, permissions: [...extra] as Permission[] } }); onSaved(); onClose(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
          }}
        >
          Save access
        </button>
      </div>
    </Modal>
  );
}
