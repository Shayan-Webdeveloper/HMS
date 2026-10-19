"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

const MAX = 10 * 1024 * 1024;

export function AttachmentUploader({ studyId }) {
  const router = useRouter();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  async function upload(file) {
    if (!file) return;
    if (file.size > MAX) { toast.error("File is larger than 10 MB"); return; }
    const fd = new FormData();
    fd.set("file", file);
    setBusy(true);
    try {
      const res = await fetch(`/api/radiology/${studyId}/attachments`, { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.error?.message || "Upload failed");
      toast.success("Attachment uploaded");
      router.refresh();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <input ref={input} id={`att-${studyId}`} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} disabled={busy} />
      <label htmlFor={`att-${studyId}`} className={`btn btn-secondary ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />} Upload PDF / image
      </label>
      <span className="text-xs text-subtle">PDF, PNG or JPEG · max 10 MB · stored privately</span>
    </div>
  );
}
