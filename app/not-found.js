import Link from "next/link";
export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="card p-8 text-center max-w-md">
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="text-xl font-bold mt-1">Page not found</h1>
        <p className="text-muted mt-2 text-[13.5px]">The page or record you requested does not exist, or you do not have access to it.</p>
        <Link href="/" className="btn btn-primary mt-5">Go to dashboard</Link>
      </div>
    </div>
  );
}
