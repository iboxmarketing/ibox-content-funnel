import { buildCatalogPreview, type CatalogAdapterInput, type CatalogPreview, type CatalogSourceRow } from "./catalog-adapter";
import type { KnowledgeGraph } from "./knowledge-types";

export const LOCAL_PREVIEW_HOST = "terminal.local";
export const REAL_SNAPSHOT_FIXTURE_ID = "REAL_SNAPSHOT_REGRESSION";
export const MINDMAP_UI_FIXTURE_ID = "MINDMAP_UI_REGRESSION";

export function isManagedLocalPreview(requestUrl: string) {
  return new URL(requestUrl).hostname === LOCAL_PREVIEW_HOST;
}

function row(sourceTab: string, sourceRow: number, sourceId: string, raw: Record<string, string>): CatalogSourceRow {
  return { sourceTab, sourceRow, sourceId, raw };
}

function tab(title: string, rows: CatalogSourceRow[], headers?: string[]) {
  return {
    title,
    sheetId: 900_000 + title.length,
    rowCount: 500,
    columnCount: headers?.length ?? Object.keys(rows[0]?.raw ?? {}).length,
    headers: headers ?? Object.keys(rows[0]?.raw ?? {}),
    rows,
  };
}

/**
 * Versioned, read-only regression overlay built from the explicitly inspected
 * 33/35 snapshot. It is available only through the managed local-preview host.
 * It is not a Sheet fallback and it never represents current runtime tasks.
 */
export function buildRealSnapshotRegressionPreview(): CatalogPreview {
  const planRows = [
    row("33_TOPIC_PACKAGE_PLAN", 5, "TP-202610-01", {
      Package_Plan_ID: "TP-202610-01", Suggested_Order: "1", Primary_Area: "Ombor", Topic_UZ: "Tizimdagi va haqiqiy qoldiq nega farq qiladi?", Cluster_ID: "CL-019", Main_Node_ID: "ND-019-01", Package_Objective_UZ: "Qoldiq farqini aniqlash", Planning_Status: "Taklif",
    }),
    row("33_TOPIC_PACKAGE_PLAN", 6, "TP-202610-02", {
      Package_Plan_ID: "TP-202610-02", Suggested_Order: "2", Primary_Area: "Moliya", Topic_UZ: "Savdo bor, pul yetmaydi: foyda va pul oqimi nega farq qiladi?", Cluster_ID: "CL-031", Main_Node_ID: "ND-031-01", Package_Objective_UZ: "Foyda va pul oqimini ajratish", Planning_Status: "Tasdiqlangan reja",
    }),
  ];
  const itemSpecs: Array<[string, string, string, string, string]> = [
    ["TPI-202610-01-BLOG", "TP-202610-01", "BLOG", "Tayanch maqola", "CH-IBOX-WEB"],
    ["TPI-202610-01-SHORT-01", "TP-202610-01", "SHORT_VIDEO", "Qoldiq farqining birinchi signali", "CH-IBOX-IG|CH-IBOX-YT|CH-IBOX-TG"],
    ["TPI-202610-01-SHORT-02", "TP-202610-01", "SHORT_VIDEO", "Qoldiq farqining ikkinchi signali", "CH-IBOX-IG|CH-IBOX-YT|CH-IBOX-TG"],
    ["TPI-202610-01-STATIC", "TP-202610-01", "STATIC_VISUAL", "Qoldiq tekshiruvi", "CH-IBOX-IG|CH-IBOX-TG"],
    ["TPI-202610-01-TEXT", "TP-202610-01", "TEXT_POST", "Qoldiqni tekshirish savoli", "CH-IBOX-TG"],
    ["TPI-202610-02-BLOG", "TP-202610-02", "BLOG", "Foyda va pul oqimi: tayanch maqola", "CH-IBOX-WEB"],
    ["TPI-202610-02-LONG", "TP-202610-02", "LONG_VIDEO", "Foyda va pul oqimi: uzun video taklifi", "CH-IBOX-YT"],
    ["TPI-202610-02-SHORT-01", "TP-202610-02", "SHORT_VIDEO", "Foyda bor, pul yo‘q — birinchi izoh", "CH-IBOX-IG|CH-IBOX-YT|CH-IBOX-TG"],
    ["TPI-202610-02-SHORT-02", "TP-202610-02", "SHORT_VIDEO", "Pul qayerda ushlanib qoladi?", "CH-IBOX-IG|CH-IBOX-YT|CH-IBOX-TG"],
    ["TPI-202610-02-STATIC", "TP-202610-02", "STATIC_VISUAL", "Pul oqimi xaritasi", "CH-IBOX-IG|CH-IBOX-TG"],
    ["TPI-202610-02-TEXT", "TP-202610-02", "TEXT_POST", "Pul oqimini tekshirish savoli", "CH-IBOX-TG"],
  ];
  const itemRows = itemSpecs.map(([id, packageId, format, title, channels], index) => row("35_TOPIC_PACKAGE_ITEMS", 5 + index, id, {
    Package_Item_ID: id,
    Package_Plan_ID: packageId,
    Item_Order: String(index < 5 ? index + 1 : index - 4),
    Workflow_ID: format === "BLOG" ? "WF-BLOG" : format === "LONG_VIDEO" ? "WF-LONG" : format === "SHORT_VIDEO" ? "WF-SHORT" : format === "STATIC_VISUAL" ? "WF-STATIC" : "WF-TEXT",
    Format_Code: format,
    Working_Title_UZ: title,
    Source_Node_ID: packageId === "TP-202610-02" ? "ND-031-01" : "ND-019-01",
    Source_Production_ID: packageId === "TP-202610-02" ? "PROD-031-01" : "PROD-019-01",
    Source_Package_Item_ID: format === "BLOG" ? "" : `${packageId.replace("TP-", "TPI-")}-BLOG`,
    Channel_Account_IDs: channels,
    Language: "UZ",
    Quantity: "1",
    Required: "FALSE",
    Approval_Status: "Taklif",
    Owner_Employee_ID: "",
    Runtime_Item_ID: "",
    Active: "FALSE",
  }));

  const workflowIds = ["WF-BLOG", "WF-LONG", "WF-SHORT", "WF-STATIC", "WF-TEXT"];
  const taskRows = workflowIds.map((workflowId, index) => row("23_TASK_TEMPLATES", 5 + index, `TT-${index + 1}`, {
    Task_Template_ID: `TT-${index + 1}`, Task_Code: `${workflowId}-BRIEF`, Task_Name_UZ: "Material brifi", Owner_Role: "Content marketer", Assignment_Rule_ID: "AR-CM-OWNER", Estimate_Minutes: "", Template_Version: "2", Template_Status: "Draft",
  }));
  const stepRows = workflowIds.map((workflowId, index) => row("25_WORKFLOW_STEPS", 5 + index, `${workflowId}-01`, {
    Workflow_ID: workflowId, Step_ID: `${workflowId}-01`, Step_Order: "1", Task_Template_ID: `TT-${index + 1}`, Dependency_Step_IDs: "", Activation_Condition: "PROJECT_SELECTED", Is_Milestone: "FALSE", Template_Version: "2", Status: "Draft",
  }));

  const input: CatalogAdapterInput = {
    spreadsheetId: "fixture:REAL_SNAPSHOT_REGRESSION",
    capturedAt: "2026-09-20T12:00:00.000Z",
    backendProjection: { available: false, realTaskCount: null },
    tabs: [
      tab("13_CONTENT_NODES", [
        row("13_CONTENT_NODES", 5, "ND-019-01", { Node_ID: "ND-019-01", Cluster_ID: "CL-019", Canonical_Problem_IDs: "CP-019", Main_Question: "Tizim va haqiqiy qoldiq nega farq qiladi?", Related_Nodes: "" }),
        row("13_CONTENT_NODES", 6, "ND-031-01", { Node_ID: "ND-031-01", Cluster_ID: "CL-031", Canonical_Problem_IDs: "CP-031", Main_Question: "Savdo bor, pul nega yetmaydi?", Related_Nodes: "" }),
      ]),
      tab("33_TOPIC_PACKAGE_PLAN", planRows),
      tab("35_TOPIC_PACKAGE_ITEMS", itemRows),
      tab("23_TASK_TEMPLATES", taskRows),
      tab("24_CHECKLIST_TEMPLATES", [row("24_CHECKLIST_TEMPLATES", 5, "CT-01", { Checklist_Template_ID: "CT-01", Task_Template_ID: "TT-1", Template_Version: "2" })]),
      tab("25_WORKFLOW_STEPS", stepRows),
      tab("26_APPROVAL_POLICIES", [row("26_APPROVAL_POLICIES", 5, "AP-EDITORIAL", { Approval_Policy_ID: "AP-EDITORIAL", Policy_Version: "2", Policy_Status: "Configured" })]),
      tab("27_ASSIGNMENT_RULES", [row("27_ASSIGNMENT_RULES", 5, "AR-CM-OWNER", { Assignment_Rule_ID: "AR-CM-OWNER", Eligible_Role: "Content marketer", Selection_Strategy: "PREFER_PROJECT_OWNER", Rule_Version: "2", Status: "Configured" })]),
      tab("28_NOTIFICATION_RULES", [row("28_NOTIFICATION_RULES", 5, "NR-01", { Rule_ID: "NR-01", Rule_Version: "2", Status: "Configured" })]),
      tab("29_SHEET_DB_CONTRACT", [row("29_SHEET_DB_CONTRACT", 5, "DC-01", { Contract_ID: "DC-01", Source_of_Truth: "GOOGLE_SHEETS", Contract_Version: "2", Status: "Confirmed" })]),
    ],
  };
  return buildCatalogPreview(input);
}

export function buildMindMapUiRegressionGraph(): KnowledgeGraph {
  return {
    areas: [{ id: "moliya", name: "Moliya", color: "#7C3AED", stageIds: ["moliya::nazorat"], processCount: 1, problemCount: 1 }],
    stages: [{ id: "moliya::nazorat", areaId: "moliya", name: "Nazorat", bosqich: "Nazorat", jarayonGuruhi: "Pul oqimi", processIds: ["JR-UI-01"], processCount: 1, problemCount: 1 }],
    processes: [{ id: "JR-UI-01", areaId: "moliya", stageId: "moliya::nazorat", jarayonId: "JR-UI-01", biznesBolimi: "Moliya", bosqich: "Nazorat", jarayonGuruhi: "Pul oqimi", kichikJarayon: "Lokal UI boshqaruv testi", asosiySavol: "Zoom tugmalari ishlaydimi?", kiruvchiMalumot: "Fixture", asosiyHarakat: "Klikni tekshirish", natija: "Transform yangilanadi", masul: "QA fixture", roleNormalized: "QA fixture", mosBiznesTuri: "Test", businessTypeNormalized: "Test", segmentUrgusi: "Test", primarySegment: "Test", segmentTags: "Test", mindmapStageId: "moliya::nazorat", mindmapStage: "Nazorat", oldingiJarayonId: "", keyingiJarayonId: "", problemIds: ["MU-UI-01"] }],
    problems: [{ id: "MU-UI-01", areaId: "moliya", muammoId: "MU-UI-01", jarayonId: "JR-UI-01", muammo: "Canvas control klikini parent pan yutishi", belgilar: "Tugma javob bermaydi", asosiySabab: "Pointer capture", qoshimchaSabablar: "", operatsionOqibat: "Zoom ishlamaydi", moliyaviyOqibat: "", mijozgaTasir: "", uzoqMuddatliXavf: "", kerakliNatija: "Tugma mustaqil ishlaydi", mosBiznesTuri: "Test", businessTypeNormalized: "Test", segmentUrgusi: "Test", primarySegment: "Test", segmentTags: "Test", ustuvorlik: "Yuqori", kontentPotensiali: "", canonicalProblemId: "CP-UI-01", manbaId: "LOCAL_FIXTURE" }],
    canonicalProblems: [{ id: "CP-UI-01", title: "Lokal UI regressiya fixture", record: { Canonical_Problem_ID: "CP-UI-01" } }],
    contentClusters: [],
    meta: { loadedAt: "2026-09-20T12:00:00.000Z", spreadsheetId: "fixture:MINDMAP_UI_REGRESSION", unlinkedProblemCount: 0, missingCanonicalLinkCount: 0, duplicateProcessCount: 0, duplicateProblemCount: 0, stageCount: 1, warnings: ["LOCAL_PREVIEW_FIXTURE — production ma’lumoti emas"] },
  };
}
