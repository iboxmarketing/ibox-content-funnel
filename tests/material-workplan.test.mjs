import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-workplan-"));
for (const name of ["cta-destination", "cta-destination-fixtures", "material-workplan", "material-workplan-fixtures", "catalog-preview-safety", "catalog-adapter", "preview-fixtures", "work-calendar", "scheduling-engine"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const work = require(join(dir, "material-workplan.js"));
const fixtures = require(join(dir, "material-workplan-fixtures.js"));
const cta = require(join(dir, "cta-destination.js"));
const ctaFixtures = require(join(dir, "cta-destination-fixtures.js"));
const { rejectCatalogPreviewMutation } = require(join(dir, "catalog-preview-safety.js"));
const { buildRealSnapshotRegressionPreview } = require(join(dir, "preview-fixtures.js"));
const { allocateWork, parseWorkWindows, wallClock } = require(join(dir, "work-calendar.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const preview = () => fixtures.buildMaterialWorkplanPreview();
const nativeCapability = (formatCode, action, channelId = "CH-IBOX-IG") => ({ channelId, formatCode, action, supported: true, analyticsCount: null, evidenceOrigin: "FIXTURE" });
const buildCandidate = (seed, selected = seed.selected) => work.createMaterialDraft({ ...seed, selected }, { nativeCapability: nativeCapability(seed.formatCode, seed.primaryCta ?? "SAVE") });
const selectedDrafts = () => preview().candidates.filter((item) => item.selected);
const plan = (drafts = selectedDrafts(), decision = "PENDING", extras = {}) => work.calculateWorkPlan({
  drafts,
  youtubeDecision: { decision, sourceArticleId: "TRAIN-CO-S4-B-ARTICLE", sourceArticleVersion: "demo.v1", reasonUz: "fixture" },
  mappings: preview().mappings,
  sharedResearchScope: { scopeId: "scope-1", sourceEntityId: "TRAIN-CO-S4-B-ARTICLE", sourceVersion: "demo.v1" },
  ...extras,
});

test("CO-S5-A01: YouTube NO removes only long path while carousel and short continue", () => {
  const long = buildCandidate({ ...fixtures.CO_S5_SHORT_THREE_CHANNEL_SEED, seedId: "long", formatCode: "LONG_VIDEO", publicationIntents: [] });
  const short = buildCandidate(fixtures.CO_S5_SHORT_THREE_CHANNEL_SEED);
  const carousel = selectedDrafts()[0];
  const result = plan([long, short, carousel], "NO");
  assert.ok(result.items.some((item) => item.scopeId === short.draftSeriesId));
  assert.ok(result.items.some((item) => item.scopeId === carousel.draftSeriesId));
  assert.ok(!result.items.some((item) => item.scopeId === long.draftSeriesId));
  assert.ok(result.diagnostics.some((item) => item.code === "LONG_PATH_NOT_SELECTED"));
});

test("CO-S5-A02: three candidates produce two local selected materials and zero real tasks", () => {
  const item = preview();
  assert.equal(item.candidates.length, 3);
  assert.equal(item.candidates.filter((draft) => draft.selected).length, 2);
  assert.equal(item.initialWorkplan.selectedMaterialCount, 2);
  assert.equal(item.initialWorkplan.writerCalls, 0);
  assert.equal(item.realSnapshotBoundary.tasksCreatedFromPreview, 0);
});

test("CO-S5-A03: every selected material carries one primary CTA; destination remains material-local", () => {
  const item = preview();
  assert.ok(item.candidates.filter((draft) => draft.selected).every((draft) => draft.primaryCta && draft.ctaContract === "VALID"));
  assert.equal(new Set(item.candidates.filter((draft) => draft.selected).map((draft) => draft.primaryCta)).size, 2);
});

test("CO-S5-A04: selecting two does not force the third or a format quota", () => {
  const item = preview();
  const inactive = item.candidates.find((draft) => draft.seedId === "CO-S5-CAROUSEL-DUPLICATE");
  assert.equal(inactive.selected, false);
  assert.ok(!item.initialWorkplan.items.some((workItem) => workItem.scopeId === inactive.draftSeriesId));
});

test("CO-S5-A05: shared research and shoot are single while edits stay per material", () => {
  const shortA = buildCandidate(fixtures.CO_S5_SHORT_THREE_CHANNEL_SEED);
  const shortB = buildCandidate({ ...fixtures.CO_S5_SHORT_THREE_CHANNEL_SEED, seedId: "short-b", titleUz: "Ikkinchi short", publicationIntents: [] });
  const result = plan([shortA, shortB], "NO");
  assert.equal(result.items.filter((item) => item.scopeType === "PACKAGE").length, 1);
  assert.equal(result.items.filter((item) => item.scopeType === "SHOOT_SESSION").length, 1);
  assert.equal(result.items.filter((item) => item.stepId === "PKG-12").length, 2);
});

test("CO-S5-A06: required output/checklist and condition guards reject invalid completion", () => {
  const item = preview().initialWorkplan.items.find((candidate) => candidate.requiredChecklistIds.length);
  assert.equal(work.evaluateCompletion(item, { outputPresent: false, requiredChecklistCompleted: false, condition: "TRUE" }).allowed, false);
  assert.equal(work.evaluateCompletion(item, { outputPresent: true, requiredChecklistCompleted: true, condition: "TRUE" }).outcome, "DONE_SIMULATED");
});

test("CO-S5-A07: Head v2 and non-author CM v1 do not approve v2", () => {
  const result = work.evaluateVersionedReview({ materialVersion: "v2", authorIds: ["DEMO_CM_A"], decisions: [{ reviewerId: "DEMO_HEAD", reviewerRole: "Head", version: "v2", decision: "APPROVE" }, { reviewerId: "DEMO_CM_B", reviewerRole: "Content marketer", version: "v1", decision: "APPROVE" }] });
  assert.equal(result.ready, false);
  assert.equal(result.headCurrentVersion, true);
  assert.equal(result.independentCmCurrentVersion, false);
});

test("CO-S5-A08 simulation boundary: workplan has no runtime identity and server mutation stays blocked", () => {
  assert.equal(preview().backendProjection.realTaskCount, null);
  assert.equal(preview().initialWorkplan.items.every((item) => item.executable === false && item.employeeId === null), true);
  assert.equal(rejectCatalogPreviewMutation({ apply: true }).status, 503);
});

test("CO-S5-T01: 3 manual variants -> 2 local drafts and writer zero", () => {
  const item = preview();
  assert.deepEqual(item.candidates.map((draft) => draft.selected), [true, true, false]);
  assert.ok(item.candidates.every((draft) => !draft.writtenToSheet && !draft.writtenToBackend && !draft.createsTask));
});

test("CO-S5-T02: incomplete draft is preservable without activating remaining candidates", () => {
  const seed = { ...fixtures.CO_S5_CANDIDATE_SEEDS[0], seedId: "blank", titleUz: "", primaryCta: null, ctaCopyUz: "", selected: false };
  const draft = work.createMaterialDraft(seed);
  assert.equal(draft.state, "INCOMPLETE");
  assert.equal(draft.storage, "LOCAL_SESSION_ONLY");
  assert.ok(draft.diagnostics.some((item) => item.code === "MATERIAL_CONTENT_INCOMPLETE"));
});

test("CO-S5-T03: edit and archive preserve stable series and readable revision history", () => {
  const first = selectedDrafts()[0];
  const changed = work.reviseMaterialDraft(first, { titleUz: "Tahrirlangan title" }, { nativeCapability: nativeCapability("CAROUSEL", "SAVE") });
  const archived = work.archiveMaterialDraft(changed.revised);
  assert.equal(changed.revised.draftSeriesId, first.draftSeriesId);
  assert.equal(changed.revised.previousRevisionId, first.draftRevisionId);
  assert.equal(archived.revised.state, "ARCHIVED_LOCAL");
  assert.equal(archived.revised.historyReadable, true);
});

test("CO-S5-T04: missing/two CTA invalidity and native no-URL behavior reuse CO-S3 evaluator", () => {
  const base = { ctaVariantId: "x", version: "v1", materialId: "m", materialVersion: "v1", primaryAction: null, actionMode: null, copyUz: "", destinationId: null, destinationDefinitionVersion: null, nativeTarget: null, observations: [], origin: "LOCAL_REGRESSION_FIXTURE" };
  assert.equal(cta.evaluateCtaDestination({ variant: base }).contractValidation, "INCOMPLETE");
  assert.equal(cta.evaluateCtaDestination({ variant: { ...base, primaryAction: "SAVE", actionMode: "NATIVE", copyUz: "Saqlang", nativeTarget: "CURRENT_PUBLICATION", observations: [{ placement: "ASSET", action: "SAVE", copyUz: "Saqlang" }, { placement: "CAPTION", action: "FOLLOW", copyUz: "Follow" }] }, nativeCapability: nativeCapability("CAROUSEL", "SAVE") }).contractValidation, "INVALID");
  assert.equal(cta.evaluateCtaDestination({ variant: { ...base, primaryAction: "SAVE", actionMode: "NATIVE", copyUz: "Saqlang", nativeTarget: "CURRENT_PUBLICATION", observations: [{ placement: "CAPTION", action: "SAVE", copyUz: "Saqlang" }] }, nativeCapability: nativeCapability("CAROUSEL", "SAVE") }).destinationReadiness, "NOT_APPLICABLE");
});

test("CO-S5-T05: TL-024 block affects its publication only, not independent SAVE work", () => {
  const ctaPreview = ctaFixtures.buildDemoCp070CtaPreview();
  const tool = ctaPreview.materials.find((item) => item.materialId === "demo:cp070:a:tool-post");
  const toolSeed = { ...fixtures.CO_S5_CANDIDATE_SEEDS[0], seedId: "tool", primaryCta: "USE_TOOL", ctaMode: "RESOURCE", ctaCopyUz: tool.variant.copyUz, destinationId: tool.destination.destinationId, destinationDefinitionVersion: tool.destination.definitionVersion, nativeTarget: null };
  const toolDraft = work.createMaterialDraft(toolSeed, { destination: tool.destination, readinessEvidence: tool.readinessEvidence });
  const saveDraft = selectedDrafts()[0];
  const result = plan([toolDraft, saveDraft]);
  assert.equal(toolDraft.ctaGate, "BLOCKED");
  assert.equal(saveDraft.ctaGate, "PASS");
  assert.ok(result.items.some((item) => item.scopeId.startsWith(toolDraft.draftSeriesId) && item.scopeType === "PUBLICATION" && item.condition === "FALSE"));
  assert.ok(result.items.some((item) => item.scopeId === saveDraft.draftSeriesId && item.scopeType === "MATERIAL"));
});

test("CO-S5-T06: YouTube PENDING/NO/YES retain pinned source and independent short", () => {
  const short = buildCandidate(fixtures.CO_S5_SHORT_THREE_CHANNEL_SEED);
  const long = buildCandidate({ ...fixtures.CO_S5_SHORT_THREE_CHANNEL_SEED, seedId: "long-y", formatCode: "LONG_VIDEO", publicationIntents: [] });
  assert.equal(plan([short, long], "PENDING").items.some((item) => item.scopeId === long.draftSeriesId), false);
  assert.equal(plan([short, long], "NO").items.some((item) => item.scopeId === short.draftSeriesId), true);
  assert.equal(plan([short, long], "YES").items.some((item) => item.scopeId === long.draftSeriesId), true);
  assert.equal(preview().youtubeDecision.sourceArticleVersion, "demo.v1");
});

test("CO-S5-T07: same TT-06 and TT-11 resolve by exact workflow/step/scope, not TT-only", () => {
  const mappings = preview().mappings;
  assert.equal(work.resolveStageAssistant({ workflowId: "WF-TEXT", stepId: "TEXT-03", taskTemplateId: "TT-06", workflowVersion: "v2", templateVersion: "v2", scope: "CONTENT" }, mappings).helperId, "AI-06");
  assert.equal(work.resolveStageAssistant({ workflowId: "WF-CAROUSEL", stepId: "CAR-04", taskTemplateId: "TT-06", workflowVersion: "v2", templateVersion: "v2", scope: "CONTENT" }, mappings).helperId, "AI-05");
  assert.equal(work.resolveStageAssistant({ workflowId: "WF-SHOOT-PACKAGE", stepId: "PKG-04", taskTemplateId: "TT-11", workflowVersion: "v2", templateVersion: "v2", scope: "PACKAGE" }, mappings).helperId, "AI-03");
  assert.equal(work.resolveStageAssistant({ workflowId: "WF-SHOOT-PACKAGE", stepId: "PKG-08", taskTemplateId: "TT-11", workflowVersion: "v2", templateVersion: "v2", scope: "CHILD_CONTENT" }, mappings).helperId, "AI-04");
});

test("CO-S5-T08: changed source hash requires recheck and unmapped decision invents no TT", () => {
  const mappings = preview().mappings;
  assert.equal(work.resolveStageAssistant({ workflowId: "WF-CAROUSEL", stepId: "CAR-03", taskTemplateId: "TT-08", workflowVersion: "v2", templateVersion: "v2", scope: "CONTENT", observedSourceHash: "changed" }, mappings).state, "MAPPING_RECHECK_REQUIRED");
  assert.equal(work.resolveStageAssistant({ workflowId: "WF-YOUTUBE", stepId: "DECIDE", taskTemplateId: "TT-MADE-UP", workflowVersion: "v2", templateVersion: "v2", scope: "CONTENT" }, mappings).state, "UNMAPPED");
});

test("CO-S5-T09: Draft config and unknown condition remain non-executable without legacy fallback", () => {
  const result = preview().initialWorkplan;
  assert.ok(result.items.every((item) => item.rawConfigState === "DRAFT" && item.executable === false));
  const unknown = { ...result.items[0], condition: "UNKNOWN" };
  assert.equal(work.evaluateCompletion(unknown, { outputPresent: true, requiredChecklistCompleted: true, condition: "UNKNOWN" }).code, "CONDITION_UNKNOWN");
  assert.equal(result.items.some((item) => ["16_PRODUCTION_SYSTEM", "19_CONTENT_WORKFLOW", "22"].includes(item.workflowId)), false);
});

test("CO-S5-T10: matching research is reused; scope mismatch raises delta research warning, not fake Done", () => {
  const matching = plan(selectedDrafts());
  assert.equal(matching.items.filter((item) => item.scopeType === "PACKAGE").length, 1);
  const mismatchedDraft = buildCandidate({ ...fixtures.CO_S5_CANDIDATE_SEEDS[0], seedId: "mismatch", sourceVersion: "demo.v2" });
  const mismatched = plan([selectedDrafts()[0], mismatchedDraft]);
  assert.ok(mismatched.diagnostics.some((item) => item.code === "SHARED_RESEARCH_SCOPE_MISMATCH"));
  assert.equal(mismatched.items.find((item) => item.scopeType === "PACKAGE").column, "PLANNED");
});

test("CO-S5-T11: one short with three channels has one shoot/edit and three intent occurrences", () => {
  const short = buildCandidate(fixtures.CO_S5_SHORT_THREE_CHANNEL_SEED);
  const result = plan([short], "NO");
  assert.equal(result.publicationIntentCount, 3);
  assert.equal(result.items.filter((item) => item.scopeType === "SHOOT_SESSION").length, 1);
  assert.equal(result.items.filter((item) => item.stepId === "PKG-12").length, 1);
  assert.equal(result.items.filter((item) => item.scopeType === "PUBLICATION").length, 3);
});

test("CO-S5-T12: reorder/title edit/repeated projection keep stable candidate keys", () => {
  const drafts = selectedDrafts();
  const first = plan(drafts);
  const repeat = plan([...drafts].reverse());
  const titleChanged = work.reviseMaterialDraft(drafts[0], { titleUz: "Boshqa UI sarlavha" }, { nativeCapability: nativeCapability("CAROUSEL", "SAVE") }).revised;
  const changed = plan([titleChanged, drafts[1]]);
  assert.deepEqual(first.items.map((item) => item.candidateKey), repeat.items.map((item) => item.candidateKey));
  const originalKeys = new Set(first.items.filter((item) => item.scopeId === drafts[0].draftSeriesId).map((item) => item.candidateKey));
  assert.ok(changed.items.filter((item) => item.scopeId === drafts[0].draftSeriesId).every((item) => originalKeys.has(item.candidateKey)));
});

test("CO-S5-T13: adding a material yields only delta and changes no runtime history", () => {
  const before = plan([selectedDrafts()[0]]);
  const after = plan(selectedDrafts());
  const delta = work.calculateWorkPlanDelta(before, after);
  assert.ok(delta.added.length > 0);
  assert.equal(delta.existingRuntimeRecordsChanged, 0);
  assert.equal(delta.removedFromProposal.length, 0);
});

test("CO-S5-T14: ALWAYS-equivalent TRUE cannot be N/A; FALSE needs reason; UNKNOWN waits", () => {
  const item = preview().initialWorkplan.items[0];
  assert.equal(work.evaluateCompletion(item, { outputPresent: true, requiredChecklistCompleted: true, condition: "TRUE", nAReasonUz: "skip" }).outcome, "DONE_SIMULATED");
  assert.equal(work.evaluateCompletion(item, { outputPresent: true, requiredChecklistCompleted: true, condition: "FALSE" }).code, "NA_REASON_REQUIRED");
  assert.equal(work.evaluateCompletion(item, { outputPresent: true, requiredChecklistCompleted: true, condition: "FALSE", nAReasonUz: "Shart false" }).outcome, "NOT_APPLICABLE");
  assert.equal(work.evaluateCompletion(item, { outputPresent: true, requiredChecklistCompleted: true, condition: "UNKNOWN" }).outcome, "WAITING");
});

test("CO-S5-T15: author/coauthor cannot satisfy independent CM and versions cannot mix", () => {
  const authors = ["DEMO_CM_A", "DEMO_CM_B"];
  const result = work.evaluateVersionedReview({ materialVersion: "v2", authorIds: authors, decisions: [{ reviewerId: "DEMO_HEAD", reviewerRole: "Head", version: "v2", decision: "APPROVE" }, { reviewerId: "DEMO_CM_B", reviewerRole: "Content marketer", version: "v2", decision: "APPROVE" }] });
  assert.equal(result.ready, false);
  assert.equal(result.independentCmCurrentVersion, false);
});

test("CO-S5-T16: revision preserves previous evidence and missing performer stays pending", () => {
  const current = selectedDrafts()[0];
  const next = work.reviseMaterialDraft(current, { structureUz: `${current.structureUz} Yangilandi.` }, { nativeCapability: nativeCapability("CAROUSEL", "SAVE") });
  assert.equal(next.previous.draftRevisionId, current.draftRevisionId);
  assert.equal(next.revised.previousRevisionId, current.draftRevisionId);
  assert.equal(work.validatePreviewAssignment({ employeeId: null, employeeRole: null, requiredRole: "Content marketer" }).code, "UNASSIGNED");
});

test("CO-S5-T17: owner/ROLE placeholder/legacy SMM never produce a new content assignee", () => {
  assert.equal(work.validatePreviewAssignment({ employeeId: "ROLE-CM", employeeRole: "Content marketer", requiredRole: "Content marketer", recordType: "ROLE_PLACEHOLDER" }).code, "ROLE_PLACEHOLDER_NOT_IDENTITY");
  assert.equal(work.validatePreviewAssignment({ employeeId: "EMP-SMM", employeeRole: "SMM manager", requiredRole: "Content marketer" }).code, "LEGACY_ROLE_NOT_ALLOWED");
  const item = preview().initialWorkplan.items.find((candidate) => candidate.role === "Content marketer");
  assert.equal(work.acceptDemoWorkItem(item, { employeeId: "DEMO_HEAD", role: "Head", origin: "DEMO_PERSONA" }).accepted, false);
});

test("CO-S5-T18: null estimate is not zero; Mon 17:00 + 5h = Tue 13:00; committed deadline stays fixed", () => {
  const item = { ...preview().initialWorkplan.items[0], committedDeadline: "2026-09-30T13:00:00.000Z" };
  const forecast = work.applyForecastWithoutDeadlineRewrite(item, "2026-10-01T10:00:00.000Z", null);
  assert.equal(forecast.estimateMinutes, null);
  assert.equal(forecast.committedDeadline, item.committedDeadline);
  const calendar = { timezone: "Asia/Tashkent", days: ["MON", "TUE", "WED", "THU", "FRI"], windows: parseWorkWindows("09:00-13:00|14:00-18:00"), holidays: [] };
  assert.equal(allocateWork(wallClock("2026-09-21", 17 * 60, calendar.timezone), 300, calendar).endAt, new Date(wallClock("2026-09-22", 13 * 60, calendar.timezone)).toISOString());
});

test("CO-S5-T19: grouped card drag to Done cannot bypass output/checklist gate", () => {
  const item = preview().initialWorkplan.items.find((candidate) => candidate.requiredChecklistIds.length);
  const rejected = work.simulateWorkItemMove(item, "DONE", { outputPresent: false, requiredChecklistCompleted: false, condition: "TRUE" });
  assert.equal(rejected.allowed, false);
  assert.notEqual(rejected.nextColumn, "DONE");
});

test("CO-S5-T20: WF-TEXT Head gate remains effective while policy B stays pending", () => {
  const item = preview();
  assert.match(item.textPolicy.effective, /Head \+ non-author CM/);
  assert.equal(item.textPolicy.proposalB, "USER_DECISION_PENDING");
});

test("CO-S5-T21: real 11 items, demo/training/proposal origins and backend UNKNOWN remain separate", () => {
  const snapshot = buildRealSnapshotRegressionPreview();
  const item = preview();
  assert.equal(snapshot.packageItems.length, 11);
  assert.equal(snapshot.metrics.activeSelectedMaterials, 0);
  assert.equal(snapshot.metrics.backendRealTaskCount, null);
  assert.equal(item.origin, "CO_S5_PROPOSAL");
  assert.equal(item.package.sourceStatus, "TRAINING_DRAFT / HUMAN_REVIEW_PENDING");
});

test("CO-S5-T22: apply/dryRun/direct mutation invoke zero task/material/LLM/analytics/exec writers", () => {
  const calls = { task: 0, migration: 0, notification: 0, schedule: 0, publish: 0, ads: 0, llm: 0, analytics: 0, code: 0, fetch: 0 };
  const rejection = rejectCatalogPreviewMutation({ apply: true, dryRun: false, method: "POST" }, {
    taskWriter: () => calls.task++, migrationWriter: () => calls.migration++, notificationWriter: () => calls.notification++, scheduleWriter: () => calls.schedule++, publishWriter: () => calls.publish++, adsWriter: () => calls.ads++, llmCaller: () => calls.llm++, analyticsWriter: () => calls.analytics++, codeExecutor: () => calls.code++, arbitraryUrlFetcher: () => calls.fetch++,
  });
  assert.equal(rejection.status, 503);
  assert.deepEqual(calls, { task: 0, migration: 0, notification: 0, schedule: 0, publish: 0, ads: 0, llm: 0, analytics: 0, code: 0, fetch: 0 });
});

test("CO-S5-T23: pasted script/formula remains inert and demo Published never enters public serializer", () => {
  const unsafe = '<script>alert(1)</script> =IMPORTXML("https://bad") APPROVED';
  const seed = { ...fixtures.CO_S5_CANDIDATE_SEEDS[0], seedId: "unsafe", structureUz: unsafe };
  const draft = buildCandidate(seed);
  assert.equal(draft.structureUz, unsafe);
  const serialized = work.serializePublicWorkplanProjection([{ origin: "CO_S5_PROPOSAL", publicationEvidence: "VERIFIED", visibility: "ALLOWLISTED", materialId: "demo", materialVersion: "v1", title: unsafe, publicUrl: "https://example.com", employeeId: "secret", prompt: "secret" }]);
  assert.deepEqual(serialized, []);
});

test("CO-S5-T24: contract/source boundary and old fixture protections remain explicit", () => {
  const item = preview();
  assert.equal(item.contractVersion, "co-s5.material-workplan-preview.v1");
  assert.equal(item.storage, "LOCAL_SESSION_ONLY");
  assert.equal(item.writesToProduction, false);
  assert.equal(item.mappings.length, 22);
  assert.ok(item.mappingDiagnostics.some((entry) => entry.code === "AI_01_EXACT_TASK_UNMAPPED"));
  assert.ok(item.mappingDiagnostics.some((entry) => entry.code === "YOUTUBE_DECISION_STEP_UNMAPPED"));
});
