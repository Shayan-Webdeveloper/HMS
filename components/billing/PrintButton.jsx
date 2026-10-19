"use client";
import { Printer } from "lucide-react";

export function PrintButton({ label = "Print" }) {
  return <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer size={15} aria-hidden /> {label}</button>;
}
