import { requirePageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ErRegisterForm } from "@/components/emergency/ErRegisterForm";

export const metadata = { title: "Register ER arrival" };

export default async function NewErVisitPage({ searchParams }) {
  await requirePageSession("emergency:manage");
  const sp = await searchParams;
  const pid = typeof sp.patientId === "string" ? sp.patientId : null;
  const p = pid ? await prisma.patient.findFirst({ where: { id: pid, status: "ACTIVE" }, select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } }) : null;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Register ER arrival" description="Register now and triage next. Unknown patients can be quick-registered with minimal details." />
      <Card>
        <ErRegisterForm initialPatient={p ? { id: p.id, label: `${p.firstName} ${p.lastName}`, sub: [p.mrn, p.phone].filter(Boolean).join(" · ") } : null}
          defaultArrivalMode={sp.mode === "AMBULANCE" ? "AMBULANCE" : "WALK_IN"} />
      </Card>
    </div>
  );
}
