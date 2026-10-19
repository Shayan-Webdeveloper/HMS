import { route } from "@/lib/api/handler";
import { getInvoiceDetail, renderInvoicePdf } from "@/lib/services/billing";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "billing:read" }, async ({ params, session, ip }) => {
  const inv = await getInvoiceDetail(params.id);
  if (!inv) throw notFound("Invoice not found");
  const pdf = await renderInvoicePdf(inv, await getHospital());
  await audit({ userId: session.user.id, action: "invoice.pdf", entityType: "Invoice", entityId: inv.id, ipAddress: ip });
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${inv.invoiceNo}.pdf"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
    },
  });
});
