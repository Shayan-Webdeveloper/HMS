"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Uploads a supporting document to the patient's record with category INSURANCE (via the shared documents API). */
export function InsuranceDocUpload({ patientId }) {
  const router = useRouter();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  async function upload(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File is larger than 10 MB"); return; }
    const fd = new FormData();
    fd.set("file", file); fd.set("patientId", patientId); fd.set("category", "INSURANCE");
    setBusy(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const j = await res.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.error?.message || "Upload failed");
      toast.success("Document uploaded");
      router.refresh();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
      <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" id="ins-doc-upload" onChange={(e) => upload(e.target.files?.[0])} />
      <label htmlFor="ins-doc-upload" className={`btn btn-secondary btn-sm ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />} Upload document
      </label>
      <span className="text-xs text-subtle">PDF, PNG or JPEG · max 10 MB · filed under “Insurance”</span>
    </div>
  );
}
