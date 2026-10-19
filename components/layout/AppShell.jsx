"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV_ICONS, Circle, Menu, PanelLeftClose, PanelLeftOpen, Search, Bell, LogOut, ChevronRight, Loader2, HeartPulse, CalendarDays, KeyRound } from "./nav-icons";
import { toast } from "sonner";
import { api } from "@/components/ui/api-client";

function NavIcon({ name }) {
  const I = NAV_ICONS[name] || Circle;
  return <I size={18} aria-hidden />;
}

export function AppShell({ nav, user, hospital, children, portal = false, todayLabel }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("hms.sidebar.collapsed") === "1"); } catch {}
  }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem("hms.sidebar.collapsed", c ? "0" : "1"); } catch {}
      return !c;
    });
  }

  const isActive = (href) => pathname === href || (href !== "/portal" && pathname.startsWith(href + "/"));

  return (
    <div className="app-shell">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-primary">Skip to content</a>
      <aside className="sidebar" data-collapsed={collapsed} data-mobile-open={mobileOpen} aria-label="Main navigation">
        <div className="flex items-center gap-3 px-4 h-[60px] border-b border-white/10 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#3b6cf6] to-[#0d9488] flex items-center justify-center shrink-0">
            <HeartPulse size={19} className="text-white" aria-hidden />
          </div>
          <div className="nav-text min-w-0">
            <p className="text-white font-semibold text-[14px] leading-tight truncate">{hospital.name}</p>
            <p className="text-[11px] text-[#8896b3] truncate">{portal ? "Patient portal" : "Hospital Management"}</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          {portal ? (
            <ul className="space-y-0.5 pt-2">
              {nav.map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="nav-link" aria-current={pathname === i.href ? "page" : undefined} title={collapsed ? i.label : undefined}>
                    <NavIcon name={i.icon} /><span className="nav-text">{i.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : nav.map((g) => (
            <div key={g.label}>
              <p className="nav-group-label"><span>{g.label}</span></p>
              <ul className="space-y-0.5">
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} className="nav-link" aria-current={isActive(i.href) ? "page" : undefined} title={collapsed ? i.label : undefined}>
                      <NavIcon name={i.icon} /><span className="nav-text">{i.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-2 hidden lg:block">
          <button type="button" onClick={toggleCollapsed} className="nav-link w-full" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span className="nav-text">Collapse</span>
          </button>
        </div>
      </aside>
      <div className="mobile-scrim" data-open={mobileOpen} onClick={() => setMobileOpen(false)} aria-hidden />

      <div className="main-area" data-collapsed={collapsed}>
        <div className="demo-ribbon">DEMONSTRATION SYSTEM — synthetic data only. Not certified for clinical use.</div>
        <header className="app-header">
          <div className="h-full flex items-center gap-3 px-4 lg:px-6">
            <button type="button" className="btn btn-ghost btn-icon lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
            <Breadcrumbs pathname={pathname} />
            <div className="flex-1" />
            {!portal && <GlobalSearch />}
            <span className="hidden xl:inline-flex items-center gap-1.5 text-[12.5px] text-muted"><CalendarDays size={14} aria-hidden />{todayLabel}</span>
            <NotificationBell portal={portal} />
            <UserMenu user={user} />
          </div>
        </header>
        <main id="main" className="page" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

const LABELS = { "": "Home", portal: "Portal", "audit-logs": "Audit logs", "medical-records": "Medical records" };

function Breadcrumbs({ pathname }) {
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = parts.map((p, i) => {
    const href = "/" + parts.slice(0, i + 1).join("/");
    const looksLikeId = p.length > 18 && /\d/.test(p);
    const label = LABELS[p] || (looksLikeId ? "Details" : p.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
    return { href, label };
  });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 hidden sm:block">
      <ol className="flex items-center gap-1 text-[13px] text-muted min-w-0">
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight size={13} className="text-subtle shrink-0" aria-hidden />}
            {i === crumbs.length - 1 ? <span className="text-ink font-medium truncate" aria-current="page">{c.label}</span>
              : <Link href={c.href} className="hover:text-ink truncate">{c.label}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); } };
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => setRes(r.data)).catch(() => {}).finally(() => setLoading(false));
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const groups = res ? Object.entries(res).filter(([, v]) => v.length) : [];
  return (
    <div className="relative hidden md:block w-[300px]" ref={ref}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
      <input ref={inputRef} type="search" className="input pl-9 pr-12 h-9" placeholder="Search patients, invoices…" aria-label="Global search"
        value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">Ctrl K</span>
      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 mt-1 w-[380px] card shadow-[var(--shadow-lg)] max-h-[420px] overflow-y-auto z-50 py-1" role="listbox">
          {loading && <p className="px-3 py-2 text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Searching…</p>}
          {!loading && res && groups.length === 0 && <p className="px-3 py-3 text-[13px] text-muted">No results</p>}
          {groups.map(([type, items]) => (
            <div key={type} className="py-1">
              <p className="px-3 pt-1 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">{type}</p>
              {items.map((it) => (
                <button key={it.href} type="button" role="option" aria-selected="false" className="w-full text-left px-3 py-1.5 hover:bg-surface-2"
                  onClick={() => { setOpen(false); setQ(""); router.push(it.href); }}>
                  <div className="text-[13.5px] font-medium">{it.title}</div>
                  {it.sub && <div className="text-xs text-muted">{it.sub}</div>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationBell({ portal }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const ref = useRef(null);
  const router = useRouter();
  const load = () => api("/api/notifications?limit=8").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => { clearInterval(t); document.removeEventListener("mousedown", onDoc); };
  }, []);
  async function markAll() {
    await api("/api/notifications/read-all", { method: "POST" }).catch(() => toast.error("Could not update notifications"));
    load();
  }
  async function openItem(n) {
    if (!n.readAt) await api(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
    setOpen(false);
    load();
    if (n.link) router.push(n.link);
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-ghost btn-icon relative" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ""}`} aria-expanded={open}>
        <Bell size={18} />
        {data.unread > 0 && <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center tabular">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-[360px] max-w-[calc(100vw-24px)] card shadow-[var(--shadow-lg)] z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <p className="font-semibold text-[13.5px]">Notifications</p>
            {data.unread > 0 && <button type="button" className="text-xs text-primary font-semibold hover:underline" onClick={markAll}>Mark all as read</button>}
          </div>
          <ul className="max-h-[360px] overflow-y-auto">
            {data.items.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">You're all caught up.</li>}
            {data.items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={`w-full text-left px-4 py-2.5 border-b border-border hover:bg-surface-2 ${n.readAt ? "" : "bg-primary-soft/40"}`}>
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">{n.title}</p>
                      {n.body && <p className="text-xs text-muted line-clamp-2">{n.body}</p>}
                      <p className="text-[11px] text-subtle mt-0.5">{n.category} · {new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {!portal && <Link href="/notifications" className="block text-center text-[13px] font-semibold text-primary py-2.5 hover:bg-surface-2" onClick={() => setOpen(false)}>View all</Link>}
        </div>
      )}
    </div>
  );
}

function UserMenu({ user }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  async function logout() {
    setBusy(true);
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
    // Full reload on sign-out so no cached patient data survives in the client.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
  const initials = user.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-neutral-soft" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="w-8 h-8 rounded-full bg-primary text-white text-[12px] font-bold flex items-center justify-center">{initials}</span>
        <span className="hidden md:block text-left leading-tight">
          <span className="block text-[13px] font-semibold">{user.name}</span>
          <span className="block text-[11px] text-muted">{user.roleLabel}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-56 card shadow-[var(--shadow-lg)] z-50 py-1">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[13px] font-semibold truncate">{user.name}</p>
            <p className="text-xs text-muted truncate">{user.email}</p>
          </div>
          <Link role="menuitem" href={user.profileHref} className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-surface-2" onClick={() => setOpen(false)}><KeyRound size={15} /> Account & password</Link>
          <button role="menuitem" type="button" onClick={logout} disabled={busy} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-danger hover:bg-danger-soft">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />} Sign out
          </button>
        </div>
      )}
    </div>
  );
}
