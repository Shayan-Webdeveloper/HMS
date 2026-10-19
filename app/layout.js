import "@/styles/globals.css";
import { Toaster } from "sonner";

export const metadata = {
  title: { default: "Hospital Management System", template: "%s · HMS" },
  description: "Hospital operations, clinical records and billing in one place.",
  robots: { index: false, follow: false },
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#1e4fd8" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 4000 }} />
      </body>
    </html>
  );
}
