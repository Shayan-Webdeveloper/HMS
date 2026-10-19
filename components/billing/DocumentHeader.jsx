/** Hospital letterhead + document title block for printable invoices/receipts (server component). */
export function DocumentHeader({ hospital, title, lines = [] }) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-5 border-b border-border">
      <div className="min-w-0">
        <p className="text-[19px] font-bold tracking-tight">{hospital.name}</p>
        {hospital.address && <p className="text-[12.5px] text-muted">{hospital.address}</p>}
        {(hospital.phone || hospital.email) && <p className="text-[12.5px] text-muted">{[hospital.phone, hospital.email].filter(Boolean).join(" · ")}</p>}
      </div>
      <div className="sm:text-right">
        <p className="text-[20px] font-bold uppercase tracking-wide">{title}</p>
        {lines.map(([k, v]) => <p key={k} className="text-[12.5px]"><span className="text-muted">{k}:</span> <span className="font-medium">{v}</span></p>)}
      </div>
    </header>
  );
}
