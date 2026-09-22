import { NextResponse } from "next/server";
import { getDataSourceMode, getKnowledgeRepository, getSupabaseKnowledgeRepository } from "@/lib/data-source";
import { loadForRoute } from "@/lib/data-source-route-outcome";
import { buildMindMapUiRegressionGraph, isManagedLocalPreview, MINDMAP_UI_FIXTURE_ID } from "@/lib/preview-fixtures";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isManagedLocalPreview(request.url) && url.searchParams.get("fixture") === MINDMAP_UI_FIXTURE_ID) {
    return NextResponse.json({ configured: true, fixture: MINDMAP_UI_FIXTURE_ID, graph: buildMindMapUiRegressionGraph() }, { headers: noStoreHeaders });
  }

  try {
    const mode = getDataSourceMode();
    const outcome = await loadForRoute(
      mode,
      getKnowledgeRepository(),
      getSupabaseKnowledgeRepository(),
      url.searchParams.get("refresh") === "1",
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
      { configured: true, graph: outcome.data, ...(outcome.dataSourceDiagnostic ? { dataSourceDiagnostic: outcome.dataSourceDiagnostic } : {}) },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      { configured: true, error: error instanceof Error ? error.message : "Knowledge Base sync failed" },
      { status: 502, headers: noStoreHeaders },
    );
  }
}
