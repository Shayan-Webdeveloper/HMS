"use client";
import { ErrorState } from "@/components/ui/States";
export default function Error({ reset }) {
  return <div className="card"><ErrorState action={<button className="btn btn-primary" onClick={() => reset()}>Try again</button>} /></div>;
}
