import { requireAuthenticatedUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;
  return Response.json(
    { user: { id: auth.user.id, displayName: auth.user.displayName, role: auth.user.role } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
