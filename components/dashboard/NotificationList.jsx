"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

const TONE = { APPOINTMENT: "primary", LAB: "info", PHARMACY: "teal", BILLING: "warning", ADMISSION: "primary", HR: "neutral", SYSTEM: "neutral" };

/** Mark-all control (uses the shared notifications API). */
export function MarkAllRead({ unread }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!unread) return null;
  async function go() {
    setBusy(true);
    try {
      const r = await api("/api/notifications/read-all", { method: "POST" });
      toast.success(`${r.data.updated} notification${r.data.updated === 1 ? "" : "s"} marked as read`);
      router.refresh();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <Button icon={CheckCheck} loading={busy} onClick={go}>Mark all as read</Button>;
}

/** items: [{ id, category, title, body, link, readAt, createdAtLabel }] */
export function NotificationList({ items }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  async function markRead(n, follow) {
    setBusy(n.id);
    try {
      if (!n.readAt) await api(`/api/notifications/${n.id}/read`, { method: "POST" });
      if (follow && n.link) router.push(n.link);
      else router.refresh();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((n) => (
        <li key={n.id} className={`px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3 ${n.readAt ? "" : "bg-primary-soft/40"}`}>
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.readAt ? "bg-transparent" : "bg-primary"}`} aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-[13.5px] ${n.readAt ? "font-medium" : "font-semibold"}`}>{n.title}</p>
                <Badge tone={TONE[n.category] || "neutral"} plain>{n.category.toLowerCase()}</Badge>
                {!n.readAt && <span className="sr-only">Unread</span>}
              </div>
              {n.body && <p className="text-[13px] text-muted mt-0.5">{n.body}</p>}
              <p className="text-[11.5px] text-subtle mt-1">{n.createdAtLabel}{n.readAt ? ` · read ${n.readAtLabel}` : ""}</p>
            </div>
          </div>
          <div className="flex gap-2 sm:shrink-0 pl-5 sm:pl-0">
            {n.link && <Button size="sm" icon={ExternalLink} loading={busy === n.id} onClick={() => markRead(n, true)}>Open</Button>}
            {!n.readAt && <Button size="sm" variant="ghost" icon={Check} disabled={busy === n.id} onClick={() => markRead(n, false)}>Mark read</Button>}
          </div>
        </li>
      ))}
    </ul>
  );
}
