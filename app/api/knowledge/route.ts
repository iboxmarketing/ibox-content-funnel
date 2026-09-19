import { NextResponse } from "next/server";
import { getMissingGoogleConfiguration, loadKnowledgeGraph } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET() {
  const missing = getMissingGoogleConfiguration();
  if (missing.length) {
    return NextResponse.json(
      { configured: false, missing, spreadsheetIdConfigured: !missing.includes("GOOGLE_SHEET_ID") },
      { headers: noStoreHeaders },
    );
  }

  try {
    const graph = await loadKnowledgeGraph();
    return NextResponse.json({ configured: true, graph }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { configured: true, error: error instanceof Error ? error.message : "Knowledge Base sync failed" },
      { status: 502, headers: noStoreHeaders },
    );
  }
}
