"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

const CATS = [["REFERRAL", "Referral"], ["LAB_REPORT", "Lab report"], ["IMAGING_REPORT", "Imaging report"], ["DISCHARGE_SUMMARY", "Discharge summary"], ["INSURANCE", "Insurance"], ["ID_DOCUMENT", "ID document"], ["CONSENT", "Consent form"], ["OTHER", "Other"]];

export function FileUploader({ patientId }) {
  const router = useRouter();
  const input = useRef(null);
  const [cat, setCat] = useState("OTHER");
  const [busy, setBusy] = useState(false);
  async function upload(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File is larger than 10 MB"); return; }
    const fd = new FormData();
    fd.set("file", file); fd.set("patientId", patientId); fd.set("category", cat);
    setBusy(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message || "Upload failed");
      toast.success("Document uploaded");
      router.refresh();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
      <select className="select sm:w-48" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Document category">
        {CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" id="doc-upload" onChange={(e) => upload(e.target.files?.[0])} />
      <label htmlFor="doc-upload" className={`btn btn-primary ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Upload PDF / image
      </label>
      <span className="text-xs text-subtle">PDF, PNG or JPEG · max 10 MB · stored privately</span>
    </div>
  );
}
