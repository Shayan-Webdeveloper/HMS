"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/components/ui/api-client";
import { ChargePicker } from "./ChargePicker";

export function AddChargesButton({ invoiceId, patientId, catalog, taxRate, currency, locale, tz }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={ListPlus} onClick={() => setOpen(true)}>Add charges</Button>
      <Modal open={open} onClose={() => setOpen(false)} size="xl" title="Add charges to draft" description="Unbilled charges for this patient and other services.">
        {open && (
          <ChargePicker patientId={patientId} catalog={catalog} taxRate={taxRate} currency={currency} locale={locale} tz={tz} showDrafts={false}
            submitLabel="Add to invoice" onCancel={() => setOpen(false)}
            onSubmit={async (payload) => {
              await api(`/api/invoices/${invoiceId}/items`, { method: "POST", body: payload });
              toast.success("Charges added");
              setOpen(false);
              router.refresh();
            }} />
        )}
      </Modal>
    </>
  );
}
