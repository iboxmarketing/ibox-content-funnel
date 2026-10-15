import { KnowledgeOS } from "@/components/knowledge-os";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return <KnowledgeOS currentUser={{ displayName: user.displayName, role: user.role }} />;
}
