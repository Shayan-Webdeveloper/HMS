"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, ScanLine, Search, Loader2 } from "lucide-react";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/States";
import { formatMoney } from "@/lib/utils/money";

const PRIORITIES = ["ROUTINE", "URGENT", "STAT"];

export function OrdersPanel({ encounterId, patientId, labOrders, imagingStudies, canOrderLab, canOrderImaging, canViewLab, canViewImaging, currency }) {
  const [lab, setLab] = useState(false);
  const [img, setImg] = useState(false);
  const none = labOrders.length === 0 && imagingStudies.length === 0;
  return (
    <div className="space-y-4">
      {none && <p className="text-[13px] text-muted">No laboratory or imaging orders for this consultation.</p>}
      {labOrders.map((o) => (
        <div key={o.id} className="rounded-lg border border-border">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-surface-2 border-b border-border rounded-t-lg">
            <FlaskConical size={14} className="text-muted" aria-hidden />
            {canViewLab ? <Link href={`/laboratory/${o.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{o.orderNo}</Link> : <span className="font-mono text-[12.5px] font-semibold">{o.orderNo}</span>}
            <StatusBadge status={o.status} /><StatusBadge status={o.priority} />
            <span className="text-xs text-subtle ml-auto">{o.createdLabel}</span>
          </div>
          <ul className="divide-y divide-border">
            {o.items.map((it) => {
              const r = o.status === "RELEASED" ? it.results[0] : null;
              return (
                <li key={it.id} className="px-3 py-2 flex items-center justify-between gap-3 text-[13px]">
                  <span>{it.test.name}</span>
                  <span className="text-right">
                    {r ? <><span className="font-semibold tabular">{r.value}</span> <span className="text-muted">{r.unit || it.test.unit || ""}</span>{r.referenceRange && <span className="text-xs text-subtle ml-2">ref {r.referenceRange}</span>} {r.flag && <StatusBadge status={r.flag} />}</>
                      : <span className="text-subtle text-xs">{o.status === "CANCELLED" || o.status === "REJECTED" ? "—" : "Pending"}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {imagingStudies.map((s) => (
        <div key={s.id} className="rounded-lg border border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <ScanLine size={14} className="text-muted" aria-hidden />
            {canViewImaging ? <Link href={`/radiology/${s.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{s.studyNo}</Link> : <span className="font-mono text-[12.5px] font-semibold">{s.studyNo}</span>}
            <span className="text-[13px]">{s.modality} — {s.bodyPart}</span>
            <StatusBadge status={s.status} />
            <span className="text-xs text-subtle ml-auto">{s.createdLabel}</span>
          </div>
          {s.status === "VERIFIED" && s.report?.impression && <p className="mt-1.5 text-[13px]"><span className="font-semibold">Impression:</span> {s.report.impression}</p>}
        </div>
      ))}
      {(canOrderLab || canOrderImaging) && (
        <div className="flex flex-wrap gap-2">
          {canOrderLab && <Button size="sm" icon={FlaskConical} onClick={() => setLab(true)}>Order lab tests</Button>}
          {canOrderImaging && <Button size="sm" icon={ScanLine} onClick={() => setImg(true)}>Order imaging</Button>}
        </div>
      )}
      {lab && <LabOrderDialog onClose={() => setLab(false)} encounterId={encounterId} patientId={patientId} currency={currency} />}
      {img && <ImagingOrderDialog onClose={() => setImg(false)} encounterId={encounterId} patientId={patientId} currency={currency} />}
    </div>
  );
}

function LabOrderDialog({ onClose, encounterId, patientId, currency }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [state, setState] = useState({ loading: true, error: null, tests: [] });
  const [selected, setSelected] = useState(() => new Map());
  const [priority, setPriority] = useState("ROUTINE");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      api(`/api/lab/tests?q=${encodeURIComponent(q)}&pageSize=50`, { signal: ctl.signal })
        .then((r) => setState({ loading: false, error: null, tests: r.data }))
        .catch((e) => { if (e.name !== "AbortError") setState({ loading: false, error: e.status === 404 ? "The laboratory catalogue is not available yet." : e.message, tests: [] }); });
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, reload]);

  const toggle = (t) => setSelected((m) => { const n = new Map(m); if (n.has(t.id)) n.delete(t.id); else n.set(t.id, t); return n; });
  const total = useMemo(() => [...selected.values()].reduce((s, t) => s + Number(t.price || 0), 0), [selected]);

  async function submit() {
    if (!selected.size) { setError("Select at least one test."); return; }
    setBusy(true); setError(null);
    try {
      const r = await api("/api/lab/orders", { method: "POST", body: { patientId, encounterId, testIds: [...selected.keys()], priority, clinicalNotes: notes || undefined } });
      toast.success(`Lab order ${r.data?.orderNo ?? ""} placed`);
      onClose(); router.refresh();
    } catch (e) { setError(e.status === 404 ? "Lab ordering is not available yet." : e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Order laboratory tests" description="The order is linked to this consultation and sent to the laboratory."
      footer={<><span className="mr-auto text-[12.5px] text-muted self-center">{selected.size} selected{selected.size ? ` · ${formatMoney(total, currency)}` : ""}</span><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!selected.size}>Place order</Button></>}>
      <div className="space-y-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input type="search" className="input pl-9" placeholder="Search tests by name or code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" />
        </div>
        {state.error ? <ErrorState title="Couldn't load tests" description={state.error} action={<Button size="sm" onClick={() => setReload((n) => n + 1)}>Retry</Button>} /> : (
          <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border divide-y divide-border" aria-busy={state.loading}>
            {state.loading && state.tests.length === 0 && <p className="p-3 text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading…</p>}
            {!state.loading && state.tests.length === 0 && <p className="p-3 text-[13px] text-muted">No tests match.</p>}
            {state.tests.map((t) => (
              <label key={t.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-2">
                <input type="checkbox" className="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t)} />
                <span className="flex-1 min-w-0">
                  <span className="text-[13.5px] font-medium">{t.name}</span> <span className="font-mono text-[11.5px] text-muted">{t.code}</span>
                  <span className="block text-xs text-muted">{t.category} · {t.specimenType}</span>
                </span>
                <span className="text-[12.5px] tabular text-muted">{formatMoney(t.price, currency)}</span>
              </label>
            ))}
          </div>
        )}
        <fieldset>
          <legend className="field-label">Priority</legend>
          <div className="flex gap-2" role="radiogroup">
            {PRIORITIES.map((p) => (
              <label key={p} className={`btn btn-sm ${priority === p ? "btn-primary" : "btn-secondary"}`}>
                <input type="radio" name="lab-priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="sr-only" />
                {p[0] + p.slice(1).toLowerCase()}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="field-label" htmlFor="lab-notes">Clinical notes for the lab (optional)</label>
          <textarea id="lab-notes" className="textarea" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

function ImagingOrderDialog({ onClose, encounterId, patientId, currency }) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [code, setCode] = useState("");
  const [indication, setIndication] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api("/api/radiology/catalog", { signal: ctl.signal })
      .then((r) => setState({ loading: false, error: null, items: r.data }))
      .catch((e) => { if (e.name !== "AbortError") setState({ loading: false, error: e.status === 404 ? "The imaging catalogue is not available yet." : e.message, items: [] }); });
    return () => ctl.abort();
  }, [reload]);

  async function submit() {
    if (!code) { setError("Choose a study."); return; }
    setBusy(true); setError(null);
    try {
      const r = await api("/api/radiology/studies", { method: "POST", body: { patientId, encounterId, catalogCode: code, indication: indication || undefined } });
      toast.success(`Imaging ${r.data?.studyNo ?? ""} requested`);
      onClose(); router.refresh();
    } catch (e) { setError(e.status === 404 ? "Imaging ordering is not available yet." : e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Order imaging" description="The request is linked to this consultation and sent to radiology."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!code}>Request study</Button></>}>
      <div className="space-y-4">
        {state.error ? <ErrorState title="Couldn't load the catalogue" description={state.error} action={<Button size="sm" onClick={() => setReload((n) => n + 1)}>Retry</Button>} /> : (
          <div>
            <label className="field-label" htmlFor="img-code">Study<span className="req" aria-hidden>*</span></label>
            <select id="img-code" className="select" value={code} onChange={(e) => setCode(e.target.value)} disabled={state.loading}>
              <option value="">{state.loading ? "Loading…" : "Select a study…"}</option>
              {state.items.map((i) => <option key={i.code} value={i.code}>{i.modality} — {i.bodyPart} ({formatMoney(i.price, currency)})</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="field-label" htmlFor="img-ind">Clinical indication (optional)</label>
          <textarea id="img-ind" className="textarea" rows={3} maxLength={1000} value={indication} onChange={(e) => setIndication(e.target.value)} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
