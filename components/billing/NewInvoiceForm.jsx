"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PatientSelector } from "@/components/ui/EntityPicker";
import { api } from "@/components/ui/api-client";
import { ChargePicker } from "./ChargePicker";

export function NewInvoiceForm({ initialPatient, catalog, taxRate, currency, locale, tz }) {
  const router = useRouter();
  const [patient, setPatient] = useState(initialPatient);
  return (
    <div className="space-y-6">
      <div className="max-w-xl">
        <label className="field-label" htmlFor="inv-patient">Patient<span className="req">*</span></label>
        <PatientSelector id="inv-patient" value={patient} onChange={setPatient} />
        <p className="field-hint">Choose the patient to see their unbilled consultations, tests, medicines, bed days and procedures.</p>
      </div>
      {patient ? (
        <ChargePicker key={patient.id} patientId={patient.id} catalog={catalog} taxRate={taxRate} currency={currency} locale={locale} tz={tz}
          onCancel={() => router.push("/billing")}
          onSubmit={async (payload) => {
            const r = await api("/api/invoices", { method: "POST", body: { patientId: patient.id, ...payload } });
            toast.success(`Draft invoice ${r.data.invoiceNo} created`);
            router.push(`/billing/${r.data.id}`);
            router.refresh();
          }} />
      ) : (
        <div className="rounded-lg border border-dashed border-border-strong p-8 text-center text-[13px] text-muted">Select a patient to continue.</div>
      )}
    </div>
  );
}
