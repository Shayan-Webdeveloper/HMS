import Link from "next/link";
import { ChevronLeft, BookOpen } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { listQuery } from "@/lib/validation/common";
import { describeReference } from "@/lib/validation/lab";
import { listLabTests, labCatalogFacets } from "@/lib/services/lab";
import { getHospital } from "@/lib/services/settings";
import { formatMoney } from "@/lib/utils/money";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { NewLabTestButton, LabTestRowActions } from "@/components/laboratory/LabTestCatalog";

export const metadata = { title: "Lab test catalogue" };

export default async function LabCatalogPage({ searchParams }) {
  await requirePageSession("lab:manage");
  const sp = await searchParams;
  const parsed = listQuery.safeParse({ ...sp, sort: sp.sort || "category", dir: sp.dir || "asc" });
  const q = parsed.success ? parsed.data : listQuery.parse({ sort: "category", dir: "asc" });
  const status = ["ACTIVE", "INACTIVE"].includes(sp.status) ? sp.status : "ALL";
  const category = typeof sp.category === "string" ? sp.category.slice(0, 60) : "";
  const h = await getHospital();
  const [{ rows, meta }, facets] = await Promise.all([
    listLabTests({ ...q, status, category: category || undefined }),
    labCatalogFacets(),
  ]);
  const params = { q: q.q, status: sp.status, category: category || undefined, sort: q.sort, dir: q.dir };
  const plainFacets = serialize(facets);

  return (
    <>
      <Link href="/laboratory" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ChevronLeft size={15} aria-hidden /> Laboratory worklist</Link>
      <PageHeader title="Test catalogue" description="Configure orderable tests, specimen types, reference ranges, prices and turnaround times."
        actions={<NewLabTestButton facets={plainFacets} />} />
      <div className="card">
        <FilterBar placeholder="Search code, name, category or specimen…"
          filters={[
            { name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
            { name: "category", label: "Category", options: facets.categories.map((c) => ({ value: c, label: c })) },
          ]} />
        <DataTable path="/laboratory/catalog" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Laboratory tests"
          empty={<EmptyState icon={BookOpen} title={q.q || category ? "No tests match your filters" : status === "INACTIVE" ? "No inactive tests" : "No tests configured"} description="Add tests so clinicians can order them." />}
          columns={[
            { key: "code", label: "Code", sortable: true, render: (t) => <span className="font-mono text-[12.5px] font-semibold">{t.code}</span> },
            { key: "name", label: "Test", sortable: true, render: (t) => <div><p className="font-medium">{t.name}</p><p className="text-xs text-muted">{t.specimenType}</p></div> },
            { key: "category", label: "Category", sortable: true, render: (t) => t.category },
            { key: "range", label: "Reference", render: (t) => <span className="text-muted text-[13px]">{describeReference(t) || "—"}</span> },
            { key: "price", label: "Price", sortable: true, align: "right", render: (t) => formatMoney(t.price, h.currency) },
            { key: "turnaroundHours", label: "TAT", sortable: true, align: "right", render: (t) => `${t.turnaroundHours} h` },
            { key: "used", label: "Ordered", align: "right", render: (t) => <span className="tabular">{t._count.orderItems}</span> },
            { key: "isActive", label: "Status", render: (t) => <StatusBadge status={t.isActive ? "ACTIVE" : "INACTIVE"} /> },
            { key: "actions", label: "", render: (t) => <LabTestRowActions facets={plainFacets} test={serialize({ id: t.id, code: t.code, name: t.name, category: t.category, specimenType: t.specimenType, unit: t.unit, referenceLow: t.referenceLow, referenceHigh: t.referenceHigh, referenceText: t.referenceText, price: t.price, turnaroundHours: t.turnaroundHours, isActive: t.isActive })} /> },
          ]} />
        <Pagination path="/laboratory/catalog" params={params} meta={meta} />
      </div>
    </>
  );
}
