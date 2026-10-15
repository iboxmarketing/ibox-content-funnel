import { NextResponse } from "next/server";
import { buildDemoCp070Catalog } from "@/lib/catalog-fixtures";
import { rejectCatalogPreviewMutation } from "@/lib/catalog-preview-safety";
import { buildDemoCp070CtaPreview } from "@/lib/cta-destination-fixtures";
import { buildAssistantContextPreview } from "@/lib/assistant-context-fixtures";
import { buildMaterialWorkplanPreview } from "@/lib/material-workplan-fixtures";
import { buildTrackingPreview } from "@/lib/tracking-preview-fixtures";
import { getCatalogRepository, getDataSourceMode, getSupabaseCatalogRepository } from "@/lib/data-source";
import { loadForRoute } from "@/lib/data-source-route-outcome";
import { buildRealSnapshotRegressionPreview, isManagedLocalPreview, REAL_SNAPSHOT_FIXTURE_ID } from "@/lib/preview-fixtures";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import { readSameOriginJson } from "@/lib/auth/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

const fixturePreviews = () => ({
  demo: buildDemoCp070Catalog(),
  ctaPreview: buildDemoCp070CtaPreview(),
  assistantPreview: buildAssistantContextPreview(),
  materialWorkplanPreview: buildMaterialWorkplanPreview(),
  trackingPreview: buildTrackingPreview(),
});

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  if (isManagedLocalPreview(request.url) && url.searchParams.get("fixture") === REAL_SNAPSHOT_FIXTURE_ID) {
    return NextResponse.json({
      configured: true,
      fixture: REAL_SNAPSHOT_FIXTURE_ID,
      origin: "LOCAL_REGRESSION_FIXTURE",
      preview: buildRealSnapshotRegressionPreview(),
      ...fixturePreviews(),
    }, { headers: noStoreHeaders });
  }

  try {
    const mode = getDataSourceMode();
    const outcome = await loadForRoute(
      mode,
      getCatalogRepository(),
      getSupabaseCatalogRepository(),
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
    return NextResponse.json({
      configured: true,
      origin: "CONNECTOR_LIVE_READ",
      preview: outcome.data,
      ...(outcome.dataSourceDiagnostic ? { dataSourceDiagnostic: outcome.dataSourceDiagnostic } : {}),
      ...fixturePreviews(),
    }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      { configured: true, error: error instanceof Error ? error.message : "Catalog preview sync failed" },
      { status: 502, headers: noStoreHeaders },
    );
  }
}

async function rejectMutation(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;
  const body = await readSameOriginJson(request);
  if (!body.ok) return body.response;
  const rejection = rejectCatalogPreviewMutation({ url: request.url, method: request.method });
  return NextResponse.json(rejection.body, { status: rejection.status, headers: noStoreHeaders });
}

export const POST = rejectMutation;
export const PUT = rejectMutation;
export const PATCH = rejectMutation;
export const DELETE = rejectMutation;
