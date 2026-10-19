import Link from "next/link";
import { AlertTriangle, Droplet } from "lucide-react";
import { ageFromDob, formatDateOnly } from "@/lib/utils/time";
import { StatusBadge } from "@/components/ui/Badge";

const sexLabel = (s) => (s && s !== "UNKNOWN" ? s.charAt(0) + s.slice(1).toLowerCase() : "Sex not recorded");

/** Compact patient identification banner for diagnostics pages (age/sex shown for interpreting ranges). */
export function PatientBanner({ patient, href, children }) {
  const age = ageFromDob(patient.dateOfBirth);
  const name = `${patient.firstName} ${patient.lastName}`;
  return (
    <div className="card p-4 sm:p-5 mb-5">
      <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
        <div className="flex gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-full bg-primary-soft text-primary-ink font-bold flex items-center justify-center shrink-0" aria-hidden>
            {patient.firstName?.[0]}{patient.lastName?.[0]}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {href ? <Link href={href} className="text-[17px] font-bold tracking-tight hover:text-primary">{name}</Link> : <p className="text-[17px] font-bold tracking-tight">{name}</p>}
              {patient.status && patient.status !== "ACTIVE" && <StatusBadge status={patient.status} />}
            </div>
            <p className="text-[13px] text-muted mt-0.5">
              <span className="font-mono font-semibold text-ink">{patient.mrn}</span>
              {" · "}<span className="font-semibold text-ink">{age != null ? `${age} y` : "Age unknown"}</span>
              {" · "}<span className="font-semibold text-ink">{sexLabel(patient.sex)}</span>
              {patient.dateOfBirth && <> · DOB {formatDateOnly(patient.dateOfBirth)}</>}
              {patient.bloodGroup && <> · <span className="inline-flex items-center gap-0.5"><Droplet size={12} aria-hidden />{patient.bloodGroup}</span></>}
            </p>
          </div>
        </div>
        {children && <div className="flex flex-wrap gap-2 md:justify-end">{children}</div>}
      </div>
      {patient.medicalAlerts && (
        <div className="mt-3 rounded-lg bg-warning-soft border border-warning/30 px-3 py-2 text-[13px] text-warning font-medium flex items-start gap-2" role="note">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {patient.medicalAlerts}
        </div>
      )}
    </div>
  );
}
