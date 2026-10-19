"use client";
import Link from "next/link";
import { useState } from "react";
import { BedDouble, User, Bookmark, Sparkles, Wrench, Settings2, UserPlus, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { BedStatusActions } from "./BedStatusActions";
import { cn } from "@/lib/utils/cn";

export const BED_STYLES = {
  AVAILABLE: { cls: "bg-success-soft border-success/30 text-success", icon: BedDouble, label: "Available" },
  OCCUPIED: { cls: "bg-primary-soft border-primary/30 text-primary-ink", icon: User, label: "Occupied" },
  RESERVED: { cls: "bg-info-soft border-info/30 text-info", icon: Bookmark, label: "Reserved" },
  CLEANING: { cls: "bg-warning-soft border-warning/30 text-warning", icon: Sparkles, label: "Cleaning" },
  OUT_OF_SERVICE: { cls: "bg-neutral-soft border-border-strong text-muted", icon: Wrench, label: "Out of service" },
};

export function BedLegend({ counts }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[12.5px]" aria-label="Bed status legend">
      {Object.entries(BED_STYLES).map(([k, s]) => {
        const Icon = s.icon;
        return (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-flex w-6 h-6 rounded-md border items-center justify-center", s.cls)}><Icon size={13} aria-hidden /></span>
            <span className="text-muted">{s.label}</span>
            {counts && <span className="font-semibold tabular">{counts[k] ?? 0}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function OccupancyBar({ stats }) {
  const pct = stats.occupancyPct;
  const tone = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warning" : "bg-primary";
  return (
    <div className="min-w-[160px]">
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-muted">Occupancy</span>
        <span className="font-semibold tabular">{stats.OCCUPIED}/{stats.inService} · {pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-neutral-soft overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Occupancy">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Interactive bed board. `wards` comes from getBedBoard() (serialised) with `losLabel` added per occupied bed.
 */
export function BedBoard({ wards, canManage, canAdmit, canViewAdmissions }) {
  const [selected, setSelected] = useState(null);
  if (!wards.length) return <div className="card"><EmptyState icon={BedDouble} title="No wards match" description="Adjust the filters, or add a ward to start managing beds." /></div>;
  const sel = selected && wards.flatMap((w) => w.beds.map((b) => ({ ...b, ward: w }))).find((b) => b.id === selected);

  return (
    <div className="space-y-5">
      {wards.map((w) => (
        <section key={w.id} className="card" aria-labelledby={`ward-${w.id}`}>
          <header className="flex flex-col items-start gap-3 px-[18px] py-[14px] border-b border-border sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`ward-${w.id}`} className="card-title">{w.name}</h2>
                <span className="font-mono text-[12px] text-muted">{w.code}</span>
                <Badge tone="info" plain>{w.type.toLowerCase()}</Badge>
                {!w.isActive && <Badge tone="neutral">Inactive</Badge>}
              </div>
              <p className="text-xs text-muted mt-0.5">
                {w.department?.name ? `${w.department.name} · ` : ""}{w.dailyRateLabel} / day · {w.stats.total} beds · {w.stats.AVAILABLE} available
              </p>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <OccupancyBar stats={w.stats} />
              {canManage && <Button size="sm" variant="ghost" icon={Settings2} href={`/wards/${w.id}`} aria-label={`Manage ${w.name}`}>Manage</Button>}
            </div>
          </header>
          <div className="card-body">
            {w.beds.length === 0 ? (
              <p className="text-[13px] text-muted">No beds in this ward{canManage ? " yet — add beds from Manage." : "."}</p>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2.5">
                {w.beds.map((b) => {
                  const s = BED_STYLES[b.status];
                  const Icon = s.icon;
                  const p = b.admission?.patient;
                  return (
                    <li key={b.id}>
                      <button type="button" onClick={() => setSelected(b.id)}
                        className={cn("w-full text-left rounded-lg border p-2.5 min-h-[86px] flex flex-col gap-1 transition-shadow hover:shadow-[var(--shadow-md)] focus-visible:shadow-[var(--focus-ring)]", s.cls)}
                        aria-label={`Bed ${b.label}, ${s.label}${p ? `, ${p.firstName} ${p.lastName}` : ""}`}>
                        <span className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[12.5px] font-bold">{b.label}</span>
                          <Icon size={14} aria-hidden />
                        </span>
                        {p ? (
                          <>
                            <span className="text-[12.5px] font-semibold text-ink truncate">{p.firstName} {p.lastName}</span>
                            <span className="text-[11px] text-muted truncate">{p.mrn}{b.losLabel ? ` · ${b.losLabel}` : ""}</span>
                          </>
                        ) : (
                          <span className="text-[11.5px] font-medium">{s.label}</span>
                        )}
                        {b.status === "OUT_OF_SERVICE" && b.outOfServiceReason && <span className="text-[11px] text-muted line-clamp-2">{b.outOfServiceReason}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      ))}

      <Modal open={!!sel} onClose={() => setSelected(null)} title={sel ? `Bed ${sel.label}` : ""} description={sel ? `${sel.ward.name} (${sel.ward.code})` : ""}>
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-2"><span className="text-[13px] text-muted">Status</span><StatusBadge status={sel.status} /></div>
            {sel.admission && (
              <div className="rounded-lg border border-border p-3">
                <p className="font-semibold">{sel.admission.patient.firstName} {sel.admission.patient.lastName}</p>
                <p className="text-[12.5px] text-muted">{sel.admission.patient.mrn} · {sel.admission.admissionNo}{sel.losLabel ? ` · ${sel.losLabel}` : ""}</p>
                {canViewAdmissions && <Button className="mt-3" size="sm" variant="primary" icon={ExternalLink} href={`/admissions/${sel.admission.id}`}>Open admission</Button>}
              </div>
            )}
            {sel.status === "OUT_OF_SERVICE" && (
              <p className="text-[13px]"><span className="text-muted">Reason: </span>{sel.outOfServiceReason || "Not recorded"}</p>
            )}
            {canAdmit && sel.status === "AVAILABLE" && sel.ward.isActive && (
              <Button size="sm" variant="primary" icon={UserPlus} href={`/admissions/new?wardId=${sel.ward.id}&bedId=${sel.id}`}>Admit a patient to this bed</Button>
            )}
            {canManage ? (
              <div>
                <p className="field-label">Change bed status</p>
                <BedStatusActions bed={sel} onDone={() => setSelected(null)} />
              </div>
            ) : sel.status !== "OCCUPIED" && <p className="text-xs text-muted">You can view the bed board but not change bed status.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
