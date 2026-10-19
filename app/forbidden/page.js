import Link from "next/link";
import { ShieldOff } from "lucide-react";
export const metadata = { title: "Access restricted" };
export default function Forbidden() {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="card p-8 text-center max-w-md">
        <div className="w-12 h-12 rounded-full bg-danger-soft flex items-center justify-center mx-auto"><ShieldOff className="text-danger" size={22} /></div>
        <h1 className="text-xl font-bold mt-3">Access restricted</h1>
        <p className="text-muted mt-2 text-[13.5px]">Your role does not include permission for this page. Contact an administrator if you need access.</p>
        <Link href="/" className="btn btn-primary mt-5">Back to home</Link>
      </div>
    </div>
  );
}
