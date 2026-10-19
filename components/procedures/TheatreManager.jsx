"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Power, PowerOff } from "lucide-react";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";

export function TheatreManager({ theatres, canManage }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toggle, setToggle] = useState(null);

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) { setError("Enter a theatre name"); return; }
    setBusy(true);
    try { await mutate("/api/theatres", { name: name.trim() }, { success: "Theatre added" }); setName(""); setError(""); router.refresh(); }
    catch (err) { setError(err.fields?.name || err.message); } finally { setBusy(false); }
  }

  return (
    <div>
      {canManage && (
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2 p-4 border-b border-border" noValidate>
          <div className="flex-1">
            <label htmlFor="theatre-name" className="sr-only">New theatre name</label>
            <input id="theatre-name" className="input" placeholder="New theatre name, e.g. OT-3" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setError(""); }} aria-invalid={!!error || undefined} />
            {error && <p className="field-error" role="alert">{error}</p>}
          </div>
          <Button type="submit" variant="primary" icon={Plus} loading={busy}>Add theatre</Button>
        </form>
      )}
      {theatres.length === 0 ? <EmptyState title="No theatres" description="Add an operating theatre to start scheduling." /> : (
        <ul className="divide-y divide-border">
          {theatres.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{t.name}</span>
                <Badge tone={t.isActive ? "success" : "neutral"}>{t.isActive ? "Active" : "Inactive"}</Badge>
                <span className="text-xs text-muted">{t.upcoming} upcoming booking{t.upcoming === 1 ? "" : "s"}</span>
              </div>
              {canManage && <Button size="sm" icon={t.isActive ? PowerOff : Power} onClick={() => setToggle(t)}>{t.isActive ? "Deactivate" : "Activate"}</Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!toggle} onClose={() => setToggle(null)} tone={toggle?.isActive ? "danger" : "primary"}
        title={toggle?.isActive ? `Deactivate ${toggle?.name}?` : `Activate ${toggle?.name}?`}
        message={toggle?.isActive ? "No new procedures can be booked in this theatre. Deactivation is refused while upcoming bookings exist." : "The theatre becomes available for scheduling."}
        confirmLabel={toggle?.isActive ? "Deactivate" : "Activate"}
        onConfirm={async () => {
          try { await mutate(`/api/theatres/${toggle.id}`, { isActive: !toggle.isActive }, { method: "PATCH", success: toggle.isActive ? "Theatre deactivated" : "Theatre activated" }); setToggle(null); router.refresh(); }
          catch { setToggle(null); }
        }} />
    </div>
  );
}
