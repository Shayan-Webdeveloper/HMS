import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "./WorkspaceButtons";

/** Print-friendly document frame with hospital branding (server component). Only persisted data is passed in. */
export function PrintDocument({ hospital, title, documentId, generatedLabel, backHref, backLabel = "Back", watermark, children, footer }) {
  return (
    <div className="max-w-[820px] mx-auto">
      <div className="no-print flex items-center justify-between gap-2 mb-4">
        <Link href={backHref} className="btn btn-ghost"><ArrowLeft size={15} aria-hidden /> {backLabel}</Link>
        <PrintButton />
      </div>
      <article className="print-doc card p-6 sm:p-10 relative overflow-hidden text-[13px] leading-relaxed">
        {watermark && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className="text-[64px] sm:text-[88px] font-black tracking-widest text-danger/10 -rotate-[24deg] select-none">{watermark}</span>
          </div>
        )}
        <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-4 border-b-2 border-ink">
          <div>
            <p className="text-[20px] font-bold tracking-tight">{hospital.name}</p>
            {hospital.address && <p className="text-muted">{hospital.address}</p>}
            <p className="text-muted">{[hospital.phone, hospital.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[16px] font-semibold uppercase tracking-wide">{title}</p>
            <p><span className="text-muted">Document ID:</span> <span className="font-mono font-semibold">{documentId}</span></p>
            <p className="text-muted">Generated {generatedLabel}</p>
          </div>
        </header>
        {watermark && <p className="mt-3 rounded border border-danger/40 bg-danger-soft text-danger font-semibold px-3 py-1.5 text-center">{watermark}</p>}
        <div className="relative">{children}</div>
        <footer className="mt-8 pt-3 border-t border-border text-[11px] text-subtle flex flex-col sm:flex-row sm:justify-between gap-1">
          <span>{footer || "Confidential patient information. Generated from the electronic record."}</span>
          <span className="font-mono">{documentId}</span>
        </footer>
      </article>
    </div>
  );
}

export function PrintSection({ title, children }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="text-[11.5px] font-bold uppercase tracking-wider text-muted border-b border-border pb-1 mb-2">{title}</h2>
      {children}
    </section>
  );
}
