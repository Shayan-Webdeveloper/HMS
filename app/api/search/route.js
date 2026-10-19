import { z } from "zod";
import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/auth/session";

const q = z.object({ q: z.string().trim().min(2).max(60) });

// Permission-aware global search: each resource is only queried when the user may read it,
// and results never include counts of hidden records.
export const GET = route({}, async ({ session, query }) => {
  const { q: term } = query(q);
  const ci = { contains: term, mode: "insensitive" };
  const out = {};
  if (can(session, "patients:read")) {
    const parts = term.split(/\s+/);
    const rows = await prisma.patient.findMany({
      where: { status: { not: "MERGED" }, OR: [{ mrn: ci }, { phone: { contains: term } }, { firstName: ci }, { lastName: ci }, ...(parts.length > 1 ? [{ AND: [{ firstName: { contains: parts[0], mode: "insensitive" } }, { lastName: { contains: parts[1], mode: "insensitive" } }] }] : [])] },
      take: 5, orderBy: { registeredAt: "desc" }, select: { id: true, mrn: true, firstName: true, lastName: true, phone: true },
    });
    out.Patients = rows.map((p) => ({ title: `${p.firstName} ${p.lastName}`, sub: [p.mrn, p.phone].filter(Boolean).join(" · "), href: `/patients/${p.id}` }));
  }
  if (can(session, "appointments:read")) {
    const rows = await prisma.appointment.findMany({ where: { appointmentNo: ci }, take: 5, select: { id: true, appointmentNo: true, startsAt: true, patient: { select: { firstName: true, lastName: true } } } });
    out.Appointments = rows.map((a) => ({ title: a.appointmentNo, sub: `${a.patient.firstName} ${a.patient.lastName}`, href: `/appointments/${a.id}` }));
  }
  if (can(session, "staff:read")) {
    const rows = await prisma.doctorProfile.findMany({ where: { OR: [{ staff: { firstName: ci } }, { staff: { lastName: ci } }, { specialty: ci }] }, take: 5, select: { id: true, specialty: true, staff: { select: { firstName: true, lastName: true } } } });
    out.Doctors = rows.map((d) => ({ title: `Dr. ${d.staff.firstName} ${d.staff.lastName}`, sub: d.specialty, href: `/doctors/${d.id}` }));
  }
  if (can(session, "billing:read")) {
    const rows = await prisma.invoice.findMany({ where: { invoiceNo: ci }, take: 5, select: { id: true, invoiceNo: true, status: true } });
    out.Invoices = rows.map((i) => ({ title: i.invoiceNo, sub: i.status, href: `/billing/${i.id}` }));
  }
  return out;
});
