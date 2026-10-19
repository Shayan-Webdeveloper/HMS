"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Activity } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { vitalsSchema } from "@/lib/validation/inpatient";
import { mutate } from "@/components/ui/api-client";
import { formatDateTime } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";

const SERIES = [
  { key: "pulse", name: "Pulse (bpm)", color: "#1e4fd8", axis: "left" },
  { key: "systolic", name: "Systolic (mmHg)", color: "#c81e1e", axis: "left" },
  { key: "diastolic", name: "Diastolic (mmHg)", color: "#ea7a7a", axis: "left" },
  { key: "temperatureC", name: "Temp (°C)", color: "#0d9488", axis: "right" },
];

export function VitalsPanel({ admissionId, vitals, canRecord, tz }) {
  const [open, setOpen] = useState(false);
  const chartData = vitals.map((v) => ({
    at: formatDateTime(v.recordedAt, tz, { year: undefined }),
    pulse: v.pulse, systolic: v.systolic, diastolic: v.diastolic,
    temperatureC: v.temperatureC != null ? Number(v.temperatureC) : null,
  }));
  const rows = [...vitals].reverse();

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
        <p className="text-[13px] text-muted">{vitals.length} observation set{vitals.length === 1 ? "" : "s"} recorded during this admission</p>
        {canRecord && <Button size="sm" variant="primary" icon={Plus} onClick={() => setOpen(true)}>Record vitals</Button>}
      </div>
      {vitals.length === 0 ? (
        <EmptyState icon={Activity} title="No vitals recorded" description={canRecord ? "Record the first set of observations." : "Observations recorded by nursing staff appear here."} />
      ) : (
        <>
          {vitals.length > 1 && (
            <div className="px-3 pt-4 pb-2 h-[300px]" role="img" aria-label="Trend of pulse, blood pressure and temperature">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid stroke="#e3e8ef" strokeDasharray="3 3" />
                  <XAxis dataKey="at" tick={{ fontSize: 11, fill: "#556274" }} minTickGap={24} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#556274" }} domain={["auto", "auto"]} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#556274" }} domain={[34, 42]} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {SERIES.map((s) => <Line key={s.key} yAxisId={s.axis} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="table-wrap">
            <table className="table table-responsive">
              <caption className="sr-only">Vital signs</caption>
              <thead><tr><th>Recorded</th><th className="num">BP</th><th className="num">Pulse</th><th className="num">RR</th><th className="num">Temp °C</th><th className="num">SpO₂ %</th><th className="num">Weight kg</th><th>By</th></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td data-label="Recorded">{formatDateTime(v.recordedAt, tz)}</td>
                    <td data-label="BP" className="num">{v.systolic != null ? `${v.systolic}/${v.diastolic}` : "—"}</td>
                    <td data-label="Pulse" className="num">{v.pulse ?? "—"}</td>
                    <td data-label="RR" className="num">{v.respRate ?? "—"}</td>
                    <td data-label="Temp °C" className="num">{v.temperatureC ?? "—"}</td>
                    <td data-label="SpO₂ %" className="num">{v.spo2 ?? "—"}</td>
                    <td data-label="Weight kg" className="num">{v.weightKg ?? "—"}</td>
                    <td data-label="By">{v.recordedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {open && <VitalsDialog admissionId={admissionId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function VitalsDialog({ admissionId, onClose }) {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(vitalsSchema), defaultValues: { temperatureC: "", pulse: "", respRate: "", systolic: "", diastolic: "", spo2: "", weightKg: "", heightCm: "" } });
  const rootErr = form.formState.errors._?.message;
  async function submit(values) {
    try { await mutate(`/api/admissions/${admissionId}/vitals`, values, { success: "Vitals recorded", form }); onClose(); router.refresh(); } catch { /* handled */ }
  }
  const num = { type: "number", inputMode: "decimal", step: "any" };
  return (
    <Modal open onClose={onClose} title="Record vital signs" description="Enter the values measured now. Leave fields blank if not measured."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Save</Button></>}>
      <form className="grid grid-cols-2 gap-4" onSubmit={form.handleSubmit(submit)} noValidate>
        <TextField form={form} name="systolic" label="Systolic (mmHg)" {...num} />
        <TextField form={form} name="diastolic" label="Diastolic (mmHg)" {...num} />
        <TextField form={form} name="pulse" label="Pulse (bpm)" {...num} />
        <TextField form={form} name="respRate" label="Resp. rate (/min)" {...num} />
        <TextField form={form} name="temperatureC" label="Temperature (°C)" {...num} />
        <TextField form={form} name="spo2" label="SpO₂ (%)" {...num} />
        <TextField form={form} name="weightKg" label="Weight (kg)" {...num} />
        <TextField form={form} name="heightCm" label="Height (cm)" {...num} />
        {rootErr && <p className="field-error col-span-2" role="alert">{rootErr}</p>}
        <button type="submit" className="sr-only">Save</button>
      </form>
    </Modal>
  );
}
