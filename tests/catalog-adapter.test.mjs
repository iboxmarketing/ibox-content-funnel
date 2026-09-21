import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-catalog-"));
for (const name of ["catalog-adapter", "catalog-fixtures", "catalog-preview-safety", "work-calendar", "scheduling-engine"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const adapter = require(join(dir, "catalog-adapter.js"));
const { buildDemoCp070Catalog } = require(join(dir, "catalog-fixtures.js"));
const { rejectCatalogPreviewMutation } = require(join(dir, "catalog-preview-safety.js"));
const { allocateWork, parseWorkWindows, wallClock } = require(join(dir, "work-calendar.js"));
const { applyScheduleOverrides } = require(join(dir, "scheduling-engine.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

function sourceRow(sourceTab, sourceRow, sourceId, raw) {
  return { sourceTab, sourceRow, sourceId, raw };
}

function tab(title, rows, headers = null) {
  return { title, sheetId: title.length * 100, rowCount: 500, columnCount: 30, headers: headers ?? Object.keys(rows[0]?.raw ?? { ID: "" }), rows };
}

const itemIds = [
  "TPI-202610-01-BLOG", "TPI-202610-01-SHORT-01", "TPI-202610-01-SHORT-02", "TPI-202610-01-STATIC", "TPI-202610-01-TEXT",
  "TPI-202610-02-BLOG", "TPI-202610-02-LONG", "TPI-202610-02-SHORT-01", "TPI-202610-02-SHORT-02", "TPI-202610-02-STATIC", "TPI-202610-02-TEXT",
];

function baseInput({ reorder = false, templateVersion = "2", itemStatus = "Taklif", itemActive = "FALSE", duplicateChannels = false } = {}) {
  const plans = [
    sourceRow("33_TOPIC_PACKAGE_PLAN", 5, "TP-202610-01", { Package_Plan_ID: "TP-202610-01", Suggested_Order: "1", Primary_Area: "Ombor", Topic_UZ: "Qoldiq", Cluster_ID: "CL-019", Main_Node_ID: "ND-019-01", Planning_Status: "Taklif" }),
    sourceRow("33_TOPIC_PACKAGE_PLAN", 6, "TP-202610-02", { Package_Plan_ID: "TP-202610-02", Suggested_Order: "2", Primary_Area: "Moliya", Topic_UZ: "Savdo bor, pul yetmaydi", Cluster_ID: "CL-031", Main_Node_ID: "ND-031-01", Package_Objective_UZ: "Foyda va pul oqimini ajratish", Planning_Status: "Tasdiqlangan reja" }),
  ];
  const items = itemIds.map((id, index) => {
    const packagePlanId = index < 5 ? "TP-202610-01" : "TP-202610-02";
    const formatCode = id.includes("LONG") ? "LONG_VIDEO" : id.includes("SHORT") ? "SHORT_VIDEO" : id.includes("STATIC") ? "STATIC_VISUAL" : id.includes("TEXT") ? "TEXT_POST" : "BLOG";
    return sourceRow("35_TOPIC_PACKAGE_ITEMS", 5 + index, id, {
      Package_Item_ID: id,
      Package_Plan_ID: packagePlanId,
      Item_Order: String((index < 5 ? index : index - 5) + 1),
      Workflow_ID: formatCode === "BLOG" ? "WF-BLOG" : "WF-SHORT",
      Format_Code: formatCode,
      Working_Title_UZ: id,
      Source_Node_ID: packagePlanId === "TP-202610-02" ? "ND-031-01" : "ND-019-01",
      Source_Production_ID: packagePlanId === "TP-202610-02" ? "PROD-031-01" : "PROD-019-01",
      Source_Package_Item_ID: formatCode === "BLOG" ? "" : `${packagePlanId.replace("TP-", "TPI-")}-BLOG`,
      Channel_Account_IDs: duplicateChannels && index === 0 ? "CH-IG|CH-IG|CH-TG" : formatCode === "SHORT_VIDEO" ? "CH-IBOX-IG|CH-IBOX-YT|CH-IBOX-TG" : "CH-IBOX-WEB",
      Language: "UZ", Quantity: "1", Required: "FALSE", Approval_Status: itemStatus,
      Owner_Employee_ID: "", Runtime_Item_ID: "", Active: itemActive,
    });
  });
  const tabs = [
    tab("13_CONTENT_NODES", [
      sourceRow("13_CONTENT_NODES", 5, "ND-019-01", { Node_ID: "ND-019-01", Cluster_ID: "CL-019", Canonical_Problem_IDs: "CP-019", Main_Question: "Qoldiq?", Related_Nodes: "ND-019-02" }),
      sourceRow("13_CONTENT_NODES", 6, "ND-031-01", { Node_ID: "ND-031-01", Cluster_ID: "CL-031", Canonical_Problem_IDs: "CP-031", Main_Question: "Pul nega yetmaydi?", Related_Nodes: "ND-031-02" }),
    ]),
    tab("33_TOPIC_PACKAGE_PLAN", reorder ? plans.toReversed() : plans),
    tab("35_TOPIC_PACKAGE_ITEMS", reorder ? items.toReversed() : items),
    tab("23_TASK_TEMPLATES", [sourceRow("23_TASK_TEMPLATES", 5, "TT-01", { Task_Template_ID: "TT-01", Task_Code: "BRIEF", Task_Name_UZ: "Vazifa", Owner_Role: "Content marketer", Assignment_Rule_ID: "AR-CM-OWNER", Estimate_Minutes: "", Template_Version: templateVersion, Template_Status: "Draft" })]),
    tab("24_CHECKLIST_TEMPLATES", [sourceRow("24_CHECKLIST_TEMPLATES", 5, "CT-01", { Checklist_Template_ID: "CT-01", Task_Template_ID: "TT-01", Template_Version: templateVersion })]),
    tab("25_WORKFLOW_STEPS", [
      sourceRow("25_WORKFLOW_STEPS", 5, "BLOG-01", { Workflow_ID: "WF-BLOG", Step_ID: "BLOG-01", Step_Order: "1", Task_Template_ID: "TT-01", Dependency_Step_IDs: "", Activation_Condition: "PROJECT_SELECTED", Is_Milestone: "FALSE", Template_Version: templateVersion, Status: "Draft" }),
      sourceRow("25_WORKFLOW_STEPS", 6, "SHORT-READY", { Workflow_ID: "WF-SHORT", Step_ID: "SHORT-READY", Step_Order: "1", Task_Template_ID: "", Dependency_Step_IDs: "", Activation_Condition: "UNKNOWN_RULE", Is_Milestone: "TRUE", Template_Version: templateVersion, Status: "Draft" }),
    ]),
    tab("26_APPROVAL_POLICIES", [sourceRow("26_APPROVAL_POLICIES", 5, "AP-EDITORIAL", { Approval_Policy_ID: "AP-EDITORIAL", Policy_Version: templateVersion, Policy_Status: "Configured" })]),
    tab("27_ASSIGNMENT_RULES", [sourceRow("27_ASSIGNMENT_RULES", 5, "AR-CM-OWNER", { Assignment_Rule_ID: "AR-CM-OWNER", Eligible_Role: "Content marketer", Selection_Strategy: "PREFER_PROJECT_OWNER", Rule_Version: templateVersion, Status: "Configured" })]),
    tab("28_NOTIFICATION_RULES", [sourceRow("28_NOTIFICATION_RULES", 5, "NR-01", { Rule_ID: "NR-01", Status: "Configured" })]),
    tab("29_SHEET_DB_CONTRACT", [sourceRow("29_SHEET_DB_CONTRACT", 5, "DC-01", { Contract_ID: "DC-01", Source_of_Truth: "GOOGLE_SHEETS", Status: "Confirmed" })]),
  ];
  return { spreadsheetId: "fixture-sheet", capturedAt: "2026-09-20T12:00:00.000Z", tabs, backendProjection: { available: false, realTaskCount: null } };
}

test("CO-S2-A01: A/B are independent angles, not duplicate titles", () => {
  const demo = buildDemoCp070Catalog();
  assert.equal(demo.angles.length, 2);
  assert.notEqual(demo.angles[0].questionUz, demo.angles[1].questionUz);
  assert.notEqual(demo.angles[0].outcomeUz, demo.angles[1].outcomeUz);
});

test("CO-S2-A02/A03: publication order does not rewrite learning; C insertion preserves A/B IDs", () => {
  const initial = buildDemoCp070Catalog();
  assert.deepEqual(initial.learningOrder, ["DEMO-ANG-CP070-A", "DEMO-ANG-CP070-B"]);
  assert.deepEqual(initial.publicationOrder, ["DEMO-ANG-CP070-B", "DEMO-ANG-CP070-A"]);
  const inserted = buildDemoCp070Catalog({ includeMiddleAngle: true });
  assert.deepEqual(inserted.learningOrder, ["DEMO-ANG-CP070-A", "DEMO-ANG-CP070-C", "DEMO-ANG-CP070-B"]);
  assert.ok(inserted.angles.some((item) => item.angleId === initial.angles[0].angleId));
  assert.ok(inserted.angles.some((item) => item.angleId === initial.angles[1].angleId));
});

test("CO-S2-A04/T12: one short has three stable intents; intentional duplicate occurrence survives", () => {
  const demo = buildDemoCp070Catalog();
  assert.equal(demo.materials.find((item) => item.materialId === "demo:cp070:a:short").publicationIntents.length, 3);
  const preview = adapter.buildCatalogPreview(baseInput({ duplicateChannels: true }));
  const intents = preview.packageItems[0].publicationIntents;
  assert.deepEqual(intents.map((item) => item.publicationIntentId), [
    "pub:TPI-202610-01-BLOG:CH-IG:1", "pub:TPI-202610-01-BLOG:CH-IG:2", "pub:TPI-202610-01-BLOG:CH-TG:1",
  ]);
});

test("CO-S2-A05: public serializer is allowlist-only and excludes private fields", () => {
  const output = adapter.serializePublicCatalog([
    { materialId: "draft", title: "Private", publicUrl: "/draft", language: "UZ", publishedAt: "", publicationEvidence: "UNKNOWN", visibility: "PRIVATE", employeeId: "e1", telegramId: "1", taskNotes: "secret", cost: "100", draftTitle: "draft" },
    { materialId: "published", title: "Public", publicUrl: "https://example.com/public", language: "UZ", publishedAt: "2026-10-01", publicationEvidence: "VERIFIED", visibility: "ALLOWLISTED", employeeId: "e2", taskNotes: "private" },
  ]);
  assert.deepEqual(output, [{ materialId: "published", title: "Public", publicUrl: "https://example.com/public", language: "UZ", publishedAt: "2026-10-01" }]);
  assert.equal(JSON.stringify(output).includes("employee"), false);
  assert.equal(JSON.stringify(output).includes("private"), false);
});

test("CO-S2-A06/T09: archived/replacement source keeps pinned history and never swaps to latest", () => {
  const result = adapter.evaluateSourceReference({ approvedSourceVersion: "v1", availableVersions: [{ version: "v1", archived: true, replacementVersion: "v2" }, { version: "v2", archived: false, replacementVersion: null }] });
  assert.equal(result.state, "ARCHIVED_PINNED");
  assert.equal(result.resolvedVersion, "v1");
  assert.equal(result.replacementVersion, "v2");
  assert.equal(adapter.evaluateSourceReference({ approvedSourceVersion: null, availableVersions: [] }).state, "UNKNOWN");
});

test("CO-S2-A07/A08: source card does not invent URL/timecode; relation domains remain separate", () => {
  const demo = buildDemoCp070Catalog();
  const short = demo.materials.find((item) => item.materialId === "demo:cp070:a:short");
  assert.equal(short.sourceRelation.sourceUrl, null);
  assert.equal(short.sourceRelation.sectionOrTimecode, null);
  assert.notDeepEqual(demo.relations.learning, demo.relations.production);
  assert.ok(demo.relations.related.some((edge) => edge.from === "DEMO-ANG-CP070-A" && edge.to === "DEMO-ANG-CP070-B"));
  assert.ok(demo.relations.related.some((edge) => edge.from === "DEMO-ANG-CP070-B" && edge.to === "DEMO-ANG-CP070-A"));
});

test("CO-S2-T01/T02: approved plan is 1, 11 items stay proposed/inactive, runtime task candidate is 0", () => {
  const input = baseInput();
  const before = input.tabs.find((item) => item.title === "35_TOPIC_PACKAGE_ITEMS").rows.map((row) => ({ id: row.sourceId, approval: row.raw.Approval_Status, active: row.raw.Active, owner: row.raw.Owner_Employee_ID, runtime: row.raw.Runtime_Item_ID }));
  const preview = adapter.buildCatalogPreview(input);
  const after = preview.packageItems.map((item) => ({ id: item.packageItemId, approval: item.approvalStatusRaw, active: item.active ? "TRUE" : "FALSE", owner: item.ownerEmployeeId, runtime: item.runtimeItemId }));
  assert.equal(preview.metrics.approvedPackagePlans, 1);
  assert.equal(preview.metrics.activeSelectedMaterials, 0);
  assert.equal(preview.metrics.runtimeTaskCandidateCount, 0);
  assert.equal(preview.packageItems.length, 11);
  assert.deepEqual(after, before);
});

test("CO-S2-T03/T05: Draft is browsable but not executable; FALSE and empty estimates remain typed", () => {
  const preview = adapter.buildCatalogPreview(baseInput());
  assert.ok(preview.workflowPreviews.every((workflow) => workflow.executable === false && workflow.releaseBlocked));
  assert.ok(preview.workflowPreviews.flatMap((workflow) => workflow.steps).some((step) => step.isMilestone === true && step.taskTemplateId === null));
  assert.equal(preview.packageItems[0].active, false);
  assert.equal(preview.packageItems[0].required, false);
  assert.equal(preview.workflowPreviews.find((item) => item.workflowId === "WF-BLOG").steps[0].estimateMinutes, null);
  assert.equal(preview.workflowPreviews.find((item) => item.workflowId === "WF-SHORT").steps[0].conditionState, "PENDING");
});

test("CO-S2-T04: unknown status/reference produces diagnostics and no approval/fallback", () => {
  const input = baseInput({ itemStatus: "Mystery", itemActive: "MAYBE" });
  input.tabs.find((item) => item.title === "35_TOPIC_PACKAGE_ITEMS").rows[0].raw.Package_Plan_ID = "MISSING";
  const preview = adapter.buildCatalogPreview(input);
  assert.equal(preview.packageItems[0].approvalStatus, "UNKNOWN");
  assert.equal(preview.packageItems[0].active, null);
  assert.ok(preview.diagnostics.some((item) => item.code === "DANGLING_PACKAGE_PLAN"));
  assert.ok(preview.diagnostics.some((item) => item.code === "ACTIVE_BOOLEAN_UNKNOWN"));
  assert.equal(preview.metrics.runtimeTaskCandidateCount, 0);
});

test("CO-S2-T06: reread and row reorder keep entity/intent IDs; version changes only manifest hash", () => {
  const first = adapter.buildCatalogPreview(baseInput());
  const reordered = adapter.buildCatalogPreview(baseInput({ reorder: true }));
  const changed = adapter.buildCatalogPreview(baseInput({ templateVersion: "3" }));
  const ids = (preview) => preview.packageItems.map((item) => item.packageItemId).toSorted();
  const intents = (preview) => preview.packageItems.flatMap((item) => item.publicationIntents.map((intent) => intent.publicationIntentId)).toSorted();
  assert.deepEqual(ids(first), ids(reordered));
  assert.deepEqual(intents(first), intents(reordered));
  assert.notEqual(first.configManifest.hash, changed.configManifest.hash);
  assert.deepEqual(ids(first), ids(changed));
});

test("CO-S2-T07: SMM/Developer, ROLE placeholders and reviewer=author are never silently assigned", () => {
  assert.equal(adapter.validateContentAssignment({ requiredRole: "SMM manager", candidateEmployeeId: "e1", candidateRole: "SMM manager" }).code, "LEGACY_ROLE_NOT_ALLOWED");
  assert.equal(adapter.validateContentAssignment({ requiredRole: "Digital marketer", candidateEmployeeId: "ROLE-DIGITAL", candidateRole: "Digital marketer", recordType: "ROLE_PLACEHOLDER" }).code, "ROLE_PLACEHOLDER_NOT_IDENTITY");
  assert.equal(adapter.validateContentAssignment({ requiredRole: "Content marketer", candidateEmployeeId: "cm1", candidateRole: "Content marketer", authorEmployeeIds: ["cm1"], independentReviewRequired: true }).code, "REVIEWER_IS_AUTHOR");
  assert.equal(adapter.validateContentAssignment({ requiredRole: "Content marketer", candidateEmployeeId: null, candidateRole: null }).code, "IDENTITY_UNVERIFIED");
});

test("CO-S2-T08: YouTube NO disables only long path; shorts/posts remain independent", () => {
  const result = adapter.applyYoutubeDecision([{ formatCode: "LONG_VIDEO", id: "long" }, { formatCode: "SHORT_VIDEO", id: "short" }, { formatCode: "YOUTUBE_POST", id: "post" }], "NO");
  assert.equal(result.find((item) => item.id === "long").youtubeLongPathState, "NOT_APPLICABLE");
  assert.ok(result.filter((item) => item.id !== "long").every((item) => item.youtubeLongPathState === "INDEPENDENT"));
});

test("CO-S2-T10/T11: native CTA needs no URL; multiple primaries fail; tool gate is material-local", () => {
  assert.equal(adapter.validatePrimaryCtas([{ state: "VALID", primaryType: "SAVE", nativeAction: true, destinationRef: null, variantId: "v1" }]).valid, true);
  assert.equal(adapter.validatePrimaryCtas([{ state: "VALID", primaryType: "SAVE", nativeAction: true, destinationRef: null, variantId: "v1" }, { state: "VALID", primaryType: "OPEN", nativeAction: false, destinationRef: "TL-024", variantId: "v2" }]).code, "MULTIPLE_PRIMARY_CTA");
  const demo = buildDemoCp070Catalog();
  assert.equal(demo.materials.find((item) => item.materialId === "demo:cp070:a:tool-post").publishEligibility, "BLOCKED_TOOL_NOT_READY");
  assert.equal(demo.materials.find((item) => item.materialId === "demo:cp070:a:carousel").publishEligibility, "ELIGIBLE_FIXTURE_ONLY");
});

test("CO-S2-T13/T14: preview has no writer result; unavailable backend count is null, never zero", () => {
  const calls = { task: 0, migration: 0, notification: 0, schedule: 0, publish: 0, ads: 0 };
  const rejection = rejectCatalogPreviewMutation({ dryRun: false, apply: true }, {
    taskWriter: () => { calls.task += 1; },
    migrationWriter: () => { calls.migration += 1; },
    notificationWriter: () => { calls.notification += 1; },
    scheduleWriter: () => { calls.schedule += 1; },
    publishWriter: () => { calls.publish += 1; },
    adsWriter: () => { calls.ads += 1; },
  });
  assert.equal(rejection.status, 503);
  assert.equal(rejection.body.code, "CO_S2_PREVIEW_ONLY");
  assert.deepEqual(calls, { task: 0, migration: 0, notification: 0, schedule: 0, publish: 0, ads: 0 });
  const preview = adapter.buildCatalogPreview(baseInput());
  assert.equal(preview.safetyMode, "CO_S2_PREVIEW_ONLY");
  assert.equal(preview.metrics.runtimeTaskCandidateCount, 0);
  assert.equal(preview.metrics.backendState, "UNAVAILABLE");
  assert.equal(preview.metrics.backendRealTaskCount, null);
  assert.ok(preview.diagnostics.some((item) => item.code === "CO_S2_PREVIEW_ONLY"));
  assert.ok(preview.diagnostics.some((item) => item.code === "RUNTIME_BACKEND_UNAVAILABLE"));
});

test("CO-S2-T16: Mon 17:00 + 5 work hours = Tue 13:00; forecast override does not mutate committed input", () => {
  const calendar = { timezone: "Asia/Tashkent", days: ["MON", "TUE", "WED", "THU", "FRI"], windows: parseWorkWindows("09:00-13:00|14:00-18:00"), holidays: [] };
  const start = wallClock("2026-09-21", 17 * 60, calendar.timezone);
  const allocation = allocateWork(start, 300, calendar);
  assert.equal(allocation.endAt, new Date(wallClock("2026-09-22", 13 * 60, calendar.timezone)).toISOString());
  const dataset = { items: [{ productionId: "locked", targetPublishDate: "2026-10-02", scheduleLocked: true }], settings: [{ key: "DEFAULT_REVIEW_DAYS", value: "1", active: true }], team: [], workflow: [], publishingRules: [], holidays: [] };
  const before = structuredClone(dataset);
  const simulated = applyScheduleOverrides(dataset, { settings: { DEFAULT_REVIEW_DAYS: "2" } });
  assert.deepEqual(dataset, before);
  assert.equal(simulated.items[0].targetPublishDate, dataset.items[0].targetPublishDate);
});
