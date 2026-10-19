"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ClaimCreateDialog } from "./ClaimCreateDialog";

export function NewClaimButton({ currency, locale }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>New claim</Button>
      {open && <ClaimCreateDialog currency={currency} locale={locale} onClose={() => setOpen(false)} />}
    </>
  );
}
