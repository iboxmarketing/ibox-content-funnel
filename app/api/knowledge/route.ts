import { NextResponse } from "next/server";
import { getMissingGoogleConfiguration, loadKnowledgeGraph } from "@/lib/google-sheets";
import { buildMindMapUiRegressionGraph, isManagedLocalPreview, MINDMAP_UI_FIXTURE_ID } from "@/lib/preview-fixtures";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isManagedLocalPreview(request.url) && url.searchParams.get("fixture") === MINDMAP_UI_FIXTURE_ID) {
    return NextResponse.json({ configured: true, fixture: MINDMAP_UI_FIXTURE_ID, graph: buildMindMapUiRegressionGraph() }, { headers: noStoreHeaders });
  }
  const missing = getMissingGoogleConfiguration();
  if (missing.length) {
    return NextResponse.json(
      { configured: false, missing, spreadsheetIdConfigured: !missing.includes("GOOGLE_SHEET_ID") },
      { headers: noStoreHeaders },
    );
  }

  try {
    const graph = await loadKnowledgeGraph(url.searchParams.get("refresh") === "1");
    return NextResponse.json({ configured: true, graph }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { configured: true, error: error instanceof Error ? error.message : "Knowledge Base sync failed" },
      { status: 502, headers: noStoreHeaders },
    );
  }
}
