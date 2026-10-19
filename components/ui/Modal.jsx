"use client";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Accessible modal built on the native <dialog> element (focus trapping, Esc to close,
 * inert background and top-layer rendering are provided by the browser).
 */
export function Modal({ open, onClose, title, description, size, children, footer }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cn("modal", size === "lg" && "modal-lg", size === "xl" && "modal-xl")}
      aria-labelledby={titleId}
      onClose={() => onClose?.()}
      onCancel={(e) => { e.preventDefault(); onClose?.(); }}
      onClick={(e) => { if (e.target === ref.current) onClose?.(); }}
    >
      {open && (
        <>
          <div className="modal-header">
            <div>
              <h2 id={titleId} className="text-[16px] font-semibold">{title}</h2>
              {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => onClose?.()} aria-label="Close dialog"><X size={16} /></button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
