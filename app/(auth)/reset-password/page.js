import ResetForm from "./ResetForm";
export const metadata = { title: "Choose a new password" };
export default async function Page({ searchParams }) {
  const sp = await searchParams;
  return <ResetForm token={typeof sp?.token === "string" ? sp.token : ""} />;
}
