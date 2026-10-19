"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";

/** Prints the current page; when the table is paginated, first loads the all-rows print view. */
export function PrintButton({ printHref }) {
  const router = useRouter();
  return (
    <button type="button" className="btn btn-secondary" onClick={() => (printHref ? router.push(printHref) : window.print())}>
      <Printer size={15} aria-hidden /> Print
    </button>
  );
}

/** Rendered only in the print view (?print=1): opens the browser print dialog once the page has painted. */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}
