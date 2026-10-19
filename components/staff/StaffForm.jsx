"use client";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { staffSchema, SHIFTS, enumOptions } from "@/lib/validation/staff";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { TextField, SelectField, FormSection } from "@/components/ui/Form";
import { StatusBadge } from "@/components/ui/Badge";

export function StaffForm({ staff, departments, today, positions = [] }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      firstName: staff?.firstName ?? "", lastName: staff?.lastName ?? "",
      email: staff?.email ?? "", phone: staff?.phone ?? "",
      departmentId: staff?.departmentId ?? "", position: staff?.position ?? "",
      joiningDate: staff?.joiningDate ? staff.joiningDate.slice(0, 10) : today, shift: staff?.shift ?? "",
      emergencyContactName: staff?.emergencyContactName ?? "", emergencyContactPhone: staff?.emergencyContactPhone ?? "",
      employmentStatus: "ACTIVE",
    },
  });
  const deptOptions = departments.filter((d) => d.isActive || d.id === staff?.departmentId).map((d) => ({ value: d.id, label: d.isActive ? d.name : `${d.name} (inactive)` }));
  const isDoctor = !!staff?.doctorProfile;

  async function submit(values) {
    try {
      const r = await api(staff ? `/api/staff/${staff.id}` : "/api/staff", { method: staff ? "PATCH" : "POST", body: values });
      toast.success(staff ? "Staff record updated" : `Staff member added — ${r.data.employeeNo}`);
      router.push(`/staff/${r.data.id}`);
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>
      <FormSection title="Identity & contact">
        <TextField form={form} name="firstName" label="First name" required autoComplete="off" />
        <TextField form={form} name="lastName" label="Last name" required autoComplete="off" />
        <TextField form={form} name="email" label="Work email" type="email" />
        <TextField form={form} name="phone" label="Phone" type="tel" placeholder="+92 300 1234567" />
      </FormSection>
      <FormSection title="Employment" description={staff ? undefined : "An employee number is assigned automatically."}>
        <SelectField form={form} name="departmentId" label="Department" required={isDoctor} placeholder={isDoctor ? "Select department…" : "No department"} options={deptOptions} />
        <TextField form={form} name="position" label="Position" required placeholder="e.g. Staff Nurse" list="staff-positions" />
        <datalist id="staff-positions">{positions.map((p) => <option key={p} value={p} />)}</datalist>
        <TextField form={form} name="joiningDate" label="Joining date" type="date" required />
        <SelectField form={form} name="shift" label="Shift" placeholder="Not set" options={enumOptions(SHIFTS)} />
        {staff ? (
          <div>
            <p className="field-label">Employment status</p>
            <div className="flex items-center gap-2 h-[38px]"><StatusBadge status={staff.employmentStatus} /><span className="text-xs text-muted">Change it from the staff profile (requires a reason).</span></div>
          </div>
        ) : (
          <SelectField form={form} name="employmentStatus" label="Employment status" options={[{ value: "ACTIVE", label: "Active" }, { value: "ON_LEAVE", label: "On leave" }]} />
        )}
      </FormSection>
      <FormSection title="Emergency contact" description="Visible only to HR and staff managers.">
        <TextField form={form} name="emergencyContactName" label="Name" />
        <TextField form={form} name="emergencyContactPhone" label="Phone" type="tel" />
      </FormSection>
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button href={staff ? `/staff/${staff.id}` : "/staff"}>Cancel</Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>{staff ? "Save changes" : "Add staff member"}</Button>
      </div>
    </form>
  );
}
