import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }) {
  const s = await getSession();
  if (s) redirect(s.isPatient ? "/portal" : "/dashboard");
  const sp = await searchParams;
  return <LoginForm expired={sp?.expired === "1"} showDemo={process.env.NODE_ENV !== "production"} />;
}
