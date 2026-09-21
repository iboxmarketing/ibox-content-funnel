import { NextResponse } from "next/server";
import { buildDemoCp070Catalog } from "@/lib/catalog-fixtures";
import { rejectCatalogPreviewMutation } from "@/lib/catalog-preview-safety";
import { buildDemoCp070CtaPreview } from "@/lib/cta-destination-fixtures";
import { buildAssistantContextPreview } from "@/lib/assistant-context-fixtures";
import { buildMaterialWorkplanPreview } from "@/lib/material-workplan-fixtures";
import { buildTrackingPreview } from "@/lib/tracking-preview-fixtures";
import { getMissingGoogleConfiguration, loadCatalogPreview } from "@/lib/google-sheets";
import { buildRealSnapshotRegressionPreview, isManagedLocalPreview, REAL_SNAPSHOT_FIXTURE_ID } from "@/lib/preview-fixtures";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isManagedLocalPreview(request.url) && url.searchParams.get("fixture") === REAL_SNAPSHOT_FIXTURE_ID) {
    return NextResponse.json({
      configured: true,
      fixture: REAL_SNAPSHOT_FIXTURE_ID,
      origin: "LOCAL_REGRESSION_FIXTURE",
      preview: buildRealSnapshotRegressionPreview(),
      demo: buildDemoCp070Catalog(),
      ctaPreview: buildDemoCp070CtaPreview(),
      assistantPreview: buildAssistantContextPreview(),
      materialWorkplanPreview: buildMaterialWorkplanPreview(),
      trackingPreview: buildTrackingPreview(),
    }, { headers: noStoreHeaders });
  }
  const missing = getMissingGoogleConfiguration();
  if (missing.length) {
    return NextResponse.json(
      { configured: false, missing, spreadsheetIdConfigured: !missing.includes("GOOGLE_SHEET_ID") },
      { headers: noStoreHeaders },
    );
  }
  try {
    const preview = await loadCatalogPreview(url.searchParams.get("refresh") === "1");
    return NextResponse.json({
      configured: true,
      origin: "CONNECTOR_LIVE_READ",
      preview,
      demo: buildDemoCp070Catalog(),
      ctaPreview: buildDemoCp070CtaPreview(),
      assistantPreview: buildAssistantContextPreview(),
      materialWorkplanPreview: buildMaterialWorkplanPreview(),
      trackingPreview: buildTrackingPreview(),
    }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { configured: true, error: error instanceof Error ? error.message : "Catalog preview sync failed" },
      { status: 502, headers: noStoreHeaders },
    );
  }
}

async function rejectMutation(request: Request) {
  const rejection = rejectCatalogPreviewMutation({ url: request.url, method: request.method });
  return NextResponse.json(rejection.body, { status: rejection.status, headers: noStoreHeaders });
}

export const POST = rejectMutation;
export const PUT = rejectMutation;
export const PATCH = rejectMutation;
export const DELETE = rejectMutation;
