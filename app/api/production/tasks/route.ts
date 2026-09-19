import { NextResponse } from "next/server";
import { getMissingGoogleConfiguration, loadProductionDataset, upsertProductionTaskOverride } from "@/lib/google-sheets";
import { recalculateSchedule } from "@/lib/scheduling-engine";
import type { ProductionTaskStatus } from "@/lib/production-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

export async function PATCH(request: Request) {
  const missing = getMissingGoogleConfiguration();
  if (missing.length) return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 503, headers: noStoreHeaders });
  try {
    const body = await request.json() as { taskId?: string; productionId?: string; stageId?: string; status?: ProductionTaskStatus; assigneeId?: string };
    if (body.status !== undefined || body.assigneeId !== undefined) {
      const dataset = await loadProductionDataset(true);
      const plan = recalculateSchedule(dataset).plans.find((entry) => entry.item.productionId === body.productionId);
      const stage = plan?.stages.find((entry) => entry.stageId === body.stageId);
      if (!stage) return NextResponse.json({ error: "Workflow task topilmadi" }, { status: 404, headers: noStoreHeaders });
      if (stage.locked) return NextResponse.json({ error: "Locked taskni ko‘chirish mumkin emas" }, { status: 409, headers: noStoreHeaders });
      if (body.status === "in_progress" || body.status === "done") {
        const unfinished = stage.dependencyStageIds.filter((dependencyId) => plan?.stages.find((entry) => entry.stageId === dependencyId)?.status !== "done");
        if (unfinished.length) return NextResponse.json({ error: `Avval bog‘liq tasklarni yakunlang: ${unfinished.join(", ")}` }, { status: 409, headers: noStoreHeaders });
      }
    }
    const result = await upsertProductionTaskOverride({
      taskId: body.taskId ?? "",
      productionId: body.productionId ?? "",
      stageId: body.stageId ?? "",
      status: body.status,
      assigneeId: body.assigneeId,
    });
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task update failed";
    const status = message === "WRITE_ACCESS_REQUIRED" ? 403 : 500;
    return NextResponse.json({ error: message === "WRITE_ACCESS_REQUIRED" ? "Service account’ga Google Sheet uchun Editor ruxsati kerak" : message }, { status, headers: noStoreHeaders });
  }
}
