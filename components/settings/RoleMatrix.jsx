"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Undo2, Lock } from "lucide-react";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";

const SUPER = "SUPER_ADMIN", PATIENT = "PATIENT", PORTAL = "portal:access";
const SUPER_REQUIRED = ["users:manage", "settings:manage"];

/** Why a cell cannot be toggled (mirrors the server-side rules), or null. */
function lockReason(roleKey, permKey) {
  if (roleKey === PATIENT && permKey !== PORTAL) return "The Patient role may only hold portal access";
  if (roleKey !== PATIENT && permKey === PORTAL) return "Portal access is reserved for the Patient role";
  if (roleKey === SUPER && SUPER_REQUIRED.includes(permKey)) return "Super Administrator must keep this permission";
  return null;
}

export function RoleMatrix({ roles, permissions, canEdit }) {
  const router = useRouter();
  const original = useMemo(() => Object.fromEntries(roles.map((r) => [r.key, new Set(r.permissions)])), [roles]);
  const [draft, setDraft] = useState(() => Object.fromEntries(roles.map((r) => [r.key, new Set(r.permissions)])));
  const [saving, setSaving] = useState(false);
  const groups = useMemo(() => {
    const m = new Map();
    for (const p of permissions) { if (!m.has(p.resource)) m.set(p.resource, []); m.get(p.resource).push(p); }
    return [...m];
  }, [permissions]);

  const dirtyRoles = roles.filter((r) => {
    const a = original[r.key], b = draft[r.key];
    return a.size !== b.size || [...a].some((k) => !b.has(k));
  });

  function toggle(roleKey, permKey) {
    setDraft((d) => {
      const next = new Set(d[roleKey]);
      if (next.has(permKey)) next.delete(permKey); else next.add(permKey);
      return { ...d, [roleKey]: next };
    });
  }

  async function save() {
    setSaving(true);
    const failures = [];
    for (const r of dirtyRoles) {
      try {
        const res = await api(`/api/roles/${r.key}/permissions`, { method: "PUT", body: { permissions: [...draft[r.key]] } });
        const { added, removed } = res.data;
        toast.success(`${r.name}: ${added.length} added, ${removed.length} removed`);
      } catch (e) { failures.push(`${r.name}: ${e.message}`); }
    }
    setSaving(false);
    if (failures.length) failures.forEach((f) => toast.error(f));
    router.refresh();
  }

  function discard() {
    setDraft(Object.fromEntries(roles.map((r) => [r.key, new Set(r.permissions)])));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        <p className="text-[13px] text-muted flex-1 min-w-[240px]">
          {canEdit ? "Tick a box to grant a permission to a role. Changes apply to every user with the role on their next request and are audited." : <span className="inline-flex items-center gap-1.5"><Lock size={13} aria-hidden /> Read-only — only a Super Administrator can edit role permissions.</span>}
        </p>
        {canEdit && dirtyRoles.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-warning font-semibold">{dirtyRoles.length} role{dirtyRoles.length === 1 ? "" : "s"} changed</span>
            <Button size="sm" icon={Undo2} onClick={discard} disabled={saving}>Discard</Button>
            <Button size="sm" variant="primary" icon={Save} loading={saving} onClick={save}>Save changes</Button>
          </div>
        )}
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="table text-[12.5px]">
          <caption className="sr-only">Role permission matrix</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-surface-2 min-w-[220px]">Permission</th>
              {roles.map((r) => (
                <th key={r.key} scope="col" className={`text-center !normal-case !tracking-normal min-w-[92px] ${dirtyRoles.includes(r) ? "!text-warning" : ""}`}>
                  <span className="block text-[11.5px] font-semibold leading-tight whitespace-normal">{r.name}</span>
                  <span className="block text-[10.5px] font-normal text-subtle">{r.users} user{r.users === 1 ? "" : "s"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([resource, perms]) => (
              <Fragment key={resource}>
                <tr><th scope="rowgroup" colSpan={roles.length + 1} className="!static !bg-neutral-soft text-left !py-1.5">{resource}</th></tr>
                {perms.map((p) => (
                  <tr key={p.key}>
                    <th scope="row" className="sticky left-0 !top-auto z-10 text-left !font-normal !normal-case !tracking-normal !text-ink !bg-surface !whitespace-normal">
                      <span className="block font-medium text-[12.5px]">{p.description || p.key}</span>
                      <code className="text-[10.5px] text-subtle">{p.key}</code>
                    </th>
                    {roles.map((r) => {
                      const reason = lockReason(r.key, p.key);
                      const checked = draft[r.key].has(p.key);
                      const changed = checked !== original[r.key].has(p.key);
                      return (
                        <td key={r.key} className={`text-center ${changed ? "bg-warning-soft" : ""}`}>
                          <input type="checkbox" className="checkbox" checked={checked} disabled={!canEdit || !!reason || saving}
                            onChange={() => toggle(r.key, p.key)} title={reason || undefined}
                            aria-label={`${r.name}: ${p.description || p.key}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
