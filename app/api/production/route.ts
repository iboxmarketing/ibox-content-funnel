import { NextResponse } from "next/server";
import { getContentPlanningRepository, getDataSourceMode, getSupabaseContentPlanningRepository } from "@/lib/data-source";
import { loadForRoute } from "@/lib/data-source-route-outcome";
import { requireAuthenticatedUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;
  try {
    const mode = getDataSourceMode();
    const outcome = await loadForRoute(
      mode,
      getContentPlanningRepository(),
      getSupabaseContentPlanningRepository(),
      new URL(request.url).searchParams.get("refresh") === "1",
    );

    if (outcome.kind === "NOT_CONFIGURED") {
      return NextResponse.json(
        { configured: false, missing: outcome.missing, spreadsheetIdConfigured: !outcome.missing.includes("GOOGLE_SHEET_ID") },
        { headers: noStoreHeaders },
      );
    }
    if (outcome.kind === "SCHEMA_NOT_READY") {
      return NextResponse.json({ configured: false, error: outcome.message, code: "SCHEMA_CONTRACT_NOT_READY" }, { status: 503, headers: noStoreHeaders });
    }
    return NextResponse.json(
      { configured: true, dataset: outcome.data, ...(outcome.dataSourceDiagnostic ? { dataSourceDiagnostic: outcome.dataSourceDiagnostic } : {}) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      { configured: true, error: error instanceof Error ? error.message : "Production database sync failed" },
      { status: 502, headers: noStoreHeaders },
    );
  }
}
