import { HeartPulse, ShieldCheck, Activity, CalendarCheck } from "lucide-react";

export default function AuthLayout({ children }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.05fr_1fr] bg-surface">
      <aside className="hidden lg:flex flex-col justify-between p-10 text-white relative overflow-hidden" style={{ background: "linear-gradient(160deg,#0f1d3a 0%,#163172 60%,#0f5c63 100%)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"><HeartPulse size={22} /></div>
          <span className="font-semibold text-lg">Hospital Management System</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-bold leading-tight">Every department, one dependable record.</h2>
          <p className="text-white/70 mt-3 text-[15px]">Registration, scheduling, clinical documentation, diagnostics, pharmacy and billing — connected, permission-controlled and audited.</p>
          <ul className="mt-8 space-y-3 text-[14px] text-white/85">
            <li className="flex items-center gap-3"><ShieldCheck size={18} className="text-[#7dd3c8]" /> Role-based access enforced on the server</li>
            <li className="flex items-center gap-3"><Activity size={18} className="text-[#7dd3c8]" /> Live metrics derived from real records</li>
            <li className="flex items-center gap-3"><CalendarCheck size={18} className="text-[#7dd3c8]" /> Conflict-safe scheduling and bed allocation</li>
          </ul>
        </div>
        <p className="text-[12px] text-white/50">Demonstration build. Not certified for clinical use without independent security, privacy, clinical and legal review.</p>
      </aside>
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}
