"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function PrintButton({ label = "Print" }) {
  return <Button variant="primary" icon={Printer} onClick={() => window.print()}>{label}</Button>;
}
