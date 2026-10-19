import { PrintButton } from "./PrintButton";
import { Button } from "@/components/ui/Button";

/** Printable document frame with hospital branding (server component). */
export function PrintLayout({ hospital, title, docNo, backHref, generatedLabel, children }) {
  const profile = hospital.settings?.["hospital.profile"] || {};
  const name = profile.name || hospital.name;
  const logo = profile.logoText || name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
  const contact = [profile.address || hospital.address, profile.phone || hospital.phone, profile.email || hospital.email].filter(Boolean);
  return (
    <div className="max-w-[860px] mx-auto">
      <div className="no-print flex flex-wrap justify-between gap-2 mb-4">
        <Button href={backHref}>Back</Button>
        <PrintButton />
      </div>
      <article className="card print-doc p-8 sm:p-10 bg-surface">
        <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-primary text-white font-bold flex items-center justify-center text-[15px] shrink-0" aria-hidden>{logo}</div>
            <div>
              <p className="text-[18px] font-bold leading-tight">{name}</p>
              {contact.length > 0 && <p className="text-[11.5px] text-muted">{contact.join(" · ")}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[15px] font-bold uppercase tracking-wide">{title}</p>
            {docNo && <p className="font-mono text-[13px] font-semibold">{docNo}</p>}
          </div>
        </header>
        {children}
        <footer className="mt-10 pt-3 border-t border-border text-[11px] text-subtle flex flex-wrap justify-between gap-2">
          <span>Generated {generatedLabel}</span>
          <span>Confidential patient information — handle in accordance with hospital policy.</span>
        </footer>
      </article>
    </div>
  );
}

export function PrintField({ label, children, wide }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-[13px] mt-0.5">{children || "—"}</dd>
    </div>
  );
}
