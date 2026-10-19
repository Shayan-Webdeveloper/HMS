// Sidebar structure. Each item declares the permission(s) required to see it.
// Items the user cannot access are not rendered (the server still enforces access).
// `icon` is a lucide-react icon name resolved in the client sidebar.

export const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", permission: "dashboard:read" },
      { href: "/notifications", label: "Notifications & Tasks", icon: "Bell", permission: "dashboard:read" },
    ],
  },
  {
    label: "Patient care",
    items: [
      { href: "/patients", label: "Patients", icon: "Users", permission: "patients:read" },
      { href: "/appointments", label: "Appointments", icon: "CalendarDays", permission: "appointments:read" },
      { href: "/consultations", label: "OPD & Consultations", icon: "Stethoscope", permission: ["encounters:create", "clinical:read", "appointments:update"] },
      { href: "/emergency", label: "Emergency", icon: "Siren", permission: "emergency:read" },
      { href: "/admissions", label: "IPD & Admissions", icon: "BedDouble", permission: "admissions:read" },
      { href: "/wards", label: "Wards & Beds", icon: "Building2", permission: "wards:read" },
      { href: "/procedures", label: "Operating Theatre", icon: "Scissors", permission: "procedures:read" },
    ],
  },
  {
    label: "Diagnostics",
    items: [
      { href: "/laboratory", label: "Laboratory", icon: "FlaskConical", permission: "lab:read" },
      { href: "/radiology", label: "Radiology & Imaging", icon: "ScanLine", permission: "radiology:read" },
    ],
  },
  {
    label: "Pharmacy & supplies",
    items: [
      { href: "/pharmacy", label: "Pharmacy", icon: "Pill", permission: "pharmacy:read" },
      { href: "/inventory", label: "Inventory & Procurement", icon: "Boxes", permission: "inventory:read" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/billing", label: "Billing & Payments", icon: "Receipt", permission: "billing:read" },
      { href: "/insurance", label: "Insurance & Claims", icon: "ShieldCheck", permission: "insurance:read" },
    ],
  },
  {
    label: "Organisation",
    items: [
      { href: "/doctors", label: "Doctors", icon: "UserRound", permission: "staff:read" },
      { href: "/staff", label: "Staff & HR", icon: "IdCard", permission: ["staff:read", "hr:read"] },
      { href: "/departments", label: "Departments", icon: "Network", permission: "staff:read" },
      { href: "/ambulances", label: "Ambulances", icon: "Ambulance", permission: "ambulance:read" },
    ],
  },
  {
    label: "Insights & admin",
    items: [
      { href: "/reports", label: "Reports & Analytics", icon: "BarChart3", permission: "reports:read" },
      { href: "/settings", label: "Settings", icon: "Settings", permission: ["settings:read", "users:manage"] },
      { href: "/audit-logs", label: "Audit Logs", icon: "ScrollText", permission: "audit:read" },
    ],
  },
];

export function filterNav(permissions) {
  const has = (p) => (Array.isArray(p) ? p.some((x) => permissions.includes(x)) : permissions.includes(p));
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => has(i.permission)) })).filter((g) => g.items.length);
}

export const PORTAL_NAV = [
  { href: "/portal", label: "My dashboard", icon: "LayoutDashboard" },
  { href: "/portal/appointments", label: "Appointments", icon: "CalendarDays" },
  { href: "/portal/prescriptions", label: "Prescriptions", icon: "Pill" },
  { href: "/portal/results", label: "Lab results", icon: "FlaskConical" },
  { href: "/portal/billing", label: "Invoices", icon: "Receipt" },
  { href: "/portal/documents", label: "Documents", icon: "FileText" },
  { href: "/portal/profile", label: "Profile & security", icon: "UserRound" },
];
