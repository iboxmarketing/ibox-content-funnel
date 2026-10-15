import { NextResponse } from "next/server";
import { getMissingGoogleConfiguration } from "@/lib/google-sheets";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import { readSameOriginJson } from "@/lib/auth/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function PATCH(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;
  const body = await readSameOriginJson(request);
  if (!body.ok) return body.response;
  const missing = getMissingGoogleConfiguration();
  if (missing.length) return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 503, headers: noStoreHeaders });
  try {
    return NextResponse.json({
      error: "Real tasklar Google Sheet’ga yozilmaydi. Task bot backend ulanishi va Head autentifikatsiyasi tugagach drag-and-drop faollashadi.",
      code: "TASK_BACKEND_SETUP_REQUIRED",
    }, { status: 503, headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task update failed";
    return NextResponse.json({ error: message }, { status: 500, headers: noStoreHeaders });
  }
}
