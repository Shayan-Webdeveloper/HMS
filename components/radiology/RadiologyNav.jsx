import Link from "next/link";

/** Section switcher for the radiology module (server-renderable). */
export function RadiologyNav({ active, showCatalog }) {
  const items = [{ key: "worklist", href: "/radiology", label: "Worklist" }, showCatalog && { key: "catalog", href: "/radiology/catalog", label: "Catalogue" }].filter(Boolean);
  if (items.length < 2) return null;
  return (
    <nav className="tabs mb-4" aria-label="Radiology sections">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className="tab" role="tab" aria-selected={active === i.key}>{i.label}</Link>
      ))}
    </nav>
  );
}
