import { redirect } from "next/navigation";
import { TelegramLogin } from "@/components/telegram-login";
import { getAuthenticatedUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getAuthenticatedUser();
  if (user) redirect("/");
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-auto bg-[#f4f7fb] p-5" style={{ backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
      <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-blue-100/60 to-transparent" />
      <div className="relative"><TelegramLogin /></div>
    </main>
  );
}
