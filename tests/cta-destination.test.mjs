import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-cta-"));
for (const name of ["cta-destination", "cta-destination-fixtures", "catalog-preview-safety", "catalog-adapter", "preview-fixtures", "work-calendar", "scheduling-engine"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const cta = require(join(dir, "cta-destination.js"));
const fixtures = require(join(dir, "cta-destination-fixtures.js"));
const { rejectCatalogPreviewMutation } = require(join(dir, "catalog-preview-safety.js"));
const adapter = require(join(dir, "catalog-adapter.js"));
const { buildRealSnapshotRegressionPreview } = require(join(dir, "preview-fixtures.js"));
const { applyScheduleOverrides } = require(join(dir, "scheduling-engine.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const demo = () => fixtures.buildDemoCp070CtaPreview();
const material = (id) => demo().materials.find((item) => item.materialId === id);
const baseVariant = (overrides = {}) => ({
  ctaVariantId: "test-cta-v1",
  version: "v1",
  materialId: "test-material",
  materialVersion: "m1",
  primaryAction: "SAVE",
  actionMode: "NATIVE",
  copyUz: "Saqlang.",
  destinationId: null,
  destinationDefinitionVersion: null,
  nativeTarget: "CURRENT_PUBLICATION",
  observations: [{ placement: "CAPTION", action: "SAVE", copyUz: "Saqlang." }],
  origin: "DEMO_CP070",
  ...overrides,
});
const nativeCapability = (action = "SAVE", supported = true) => ({ channelId: "CH-IG", formatCode: "CAROUSEL", action, supported, analyticsCount: null, evidenceOrigin: "FIXTURE" });
const articleDestination = (overrides = {}) => ({
  destinationId: "ARTICLE-1", definitionVersion: "v1", type: "ARTICLE", targetReference: "article:1", promisedOutcomeUz: "To‘liq tartib", language: "UZ", audience: "PUBLIC", configuredUrl: "https://fixture.invalid/article", lifecycleStatus: "ACTIVE", provenance: "fixture", ...overrides,
});
const verifiedEvidence = (overrides = {}) => ({
  destinationId: "ARTICLE-1", definitionVersion: "v1", evidenceId: "qa-1", evidenceType: "MANUAL_QA", source: "FIXTURE", observedTargetReference: "article:1", checkedAt: "2026-09-20T12:00:00Z", checkedBy: "fixture", audienceAccessible: true, promisedOutcomeMatches: true, requiredQaPassed: true, revoked: false, ...overrides,
});
const resourceVariant = (overrides = {}) => baseVariant({
  primaryAction: "READ_ARTICLE", actionMode: "RESOURCE", copyUz: "Maqolani o‘qing.", destinationId: "ARTICLE-1", destinationDefinitionVersion: "v1", nativeTarget: null,
  observations: [{ placement: "CAPTION", action: "READ_ARTICLE", copyUz: "Maqolani o‘qing." }], ...overrides,
});

test("CO-S3-A01: two effective primary actions are invalid; one remains valid", () => {
  const conflict = baseVariant({ observations: [{ placement: "ASSET", action: "USE_TOOL", copyUz: "Toolni oching" }, { placement: "CAPTION", action: "FOLLOW", copyUz: "Obuna bo‘ling" }], primaryAction: "FOLLOW" });
  assert.equal(cta.evaluateCtaDestination({ variant: conflict, nativeCapability: nativeCapability("FOLLOW") }).contractValidation, "INVALID");
  assert.equal(cta.evaluateCtaDestination({ variant: baseVariant(), nativeCapability: nativeCapability() }).contractValidation, "VALID");
});

test("CO-S3-A02: article and tool routes are independent bindings inside one package", () => {
  const preview = demo();
  const article = preview.materials.find((item) => item.variant.primaryAction === "READ_ARTICLE");
  const tool = preview.materials.find((item) => item.variant.primaryAction === "USE_TOOL");
  assert.notEqual(article.binding.bindingSeriesId, tool.binding.bindingSeriesId);
  assert.notEqual(article.binding.destinationId, tool.binding.destinationId);
  assert.equal(preview.packageRoute.primaryRoute.destinationId, "DEMO-ARTICLE-CP070-A");
});

test("CO-S3-A03/T10: native CTA requires no external URL and unknown metric is not zero", () => {
  const result = cta.evaluateCtaDestination({ variant: baseVariant({ primaryAction: "FOLLOW", observations: [{ placement: "CAPTION", action: "FOLLOW", copyUz: "Obuna bo‘ling" }] }), nativeCapability: nativeCapability("FOLLOW") });
  assert.equal(result.ctaDestinationGate, "PASS");
  assert.equal(result.destinationReadiness, "NOT_APPLICABLE");
  assert.ok(result.diagnostics.some((item) => item.code === "NATIVE_METRIC_UNKNOWN"));
});

test("CO-S3-A04/A05: TL-024 block is material-local and does not block SAVE carousel", () => {
  assert.equal(material("demo:cp070:a:tool-post").evaluation.ctaDestinationGate, "BLOCKED");
  assert.equal(material("demo:cp070:a:tool-post").evaluation.destinationReadiness, "NOT_READY");
  assert.equal(material("demo:cp070:a:carousel").evaluation.ctaDestinationGate, "PASS");
});

test("CO-S3-A06: one destination can be referenced from two packages without duplication", () => {
  const one = cta.createPublicationBinding({ publicationIntentId: "pkg-a:intent", materialId: "m-a", materialVersion: "v1", ctaVariantId: "cta-a", ctaVariantVersion: "v1", destinationId: "TL-024", destinationDefinitionVersion: "v1", nativeTarget: null, channelId: "TG", occurrenceId: "1" });
  const two = cta.createPublicationBinding({ publicationIntentId: "pkg-b:intent", materialId: "m-b", materialVersion: "v1", ctaVariantId: "cta-b", ctaVariantVersion: "v1", destinationId: "TL-024", destinationDefinitionVersion: "v1", nativeTarget: null, channelId: "IG", occurrenceId: "1" });
  assert.equal(one.destinationId, two.destinationId);
  assert.notEqual(one.bindingSeriesId, two.bindingSeriesId);
});

test("CO-S3-A07/T04: route change creates revision and preserves historical binding/intent", () => {
  const initial = material("demo:cp070:a:article-post").binding;
  const change = cta.revisePublicationBinding(initial, { ctaVariantId: "demo-cta:a:use-tool", ctaVariantVersion: "v2", destinationId: "TL-024", destinationDefinitionVersion: "sheet-observed-v1" });
  assert.equal(change.previous.bindingRevisionId, initial.bindingRevisionId);
  assert.notEqual(change.revised.bindingRevisionId, initial.bindingRevisionId);
  assert.equal(change.revised.previousBindingRevisionId, initial.bindingRevisionId);
  assert.equal(change.impact.historicalIntentIdPreserved, true);
  assert.equal(change.impact.creativeQaRequired, true);
});

test("CO-S3-A08: missing backend evidence remains UNKNOWN, never Ready", () => {
  const item = material("demo:cp070:a:article-post");
  assert.equal(item.evaluation.ctaDestinationGate, "UNKNOWN");
  assert.equal(item.evaluation.destinationReadiness, "UNKNOWN");
  assert.equal(demo().backendProjection.realPublicationCount, null);
});

test("CO-S3-T01: empty CTA draft is locally preserved, incomplete and has zero writes", () => {
  const saved = cta.createLocalCtaDraft(baseVariant({ primaryAction: null, actionMode: null, copyUz: "", observations: [] }));
  assert.equal(saved.storage, "LOCAL_SESSION_ONLY");
  assert.equal(saved.evaluation.contractValidation, "INCOMPLETE");
  assert.equal(saved.writtenToSheet, false);
  assert.equal(saved.writtenToBackend, false);
});

test("CO-S3-T02: embedded tool CTA and caption FOLLOW conflict is not hidden", () => {
  const variant = baseVariant({ primaryAction: "FOLLOW", observations: [{ placement: "ASSET", action: "USE_TOOL", copyUz: "Toolni oching" }, { placement: "CAPTION", action: "FOLLOW", copyUz: "Obuna bo‘ling" }] });
  const evaluated = cta.evaluateCtaDestination({ variant, nativeCapability: nativeCapability("FOLLOW") });
  assert.equal(evaluated.contractValidation, "INVALID");
  assert.ok(evaluated.diagnostics.some((item) => item.code === "CTA_PRIMARY_CONFLICT"));
});

test("CO-S3-T03: two caption variants reuse one base material without production duplication", () => {
  const baseMaterial = { materialId: "neutral-short", materialVersion: "m1", baseAssetId: "asset-neutral-1" };
  const a = cta.createPublicationBinding({ publicationIntentId: "intent-a", materialId: baseMaterial.materialId, materialVersion: baseMaterial.materialVersion, ctaVariantId: "cta-caption-a", ctaVariantVersion: "v1", destinationId: null, destinationDefinitionVersion: null, nativeTarget: "CURRENT_PUBLICATION", channelId: "IG", occurrenceId: "1" });
  const b = cta.createPublicationBinding({ publicationIntentId: "intent-b", materialId: baseMaterial.materialId, materialVersion: baseMaterial.materialVersion, ctaVariantId: "cta-caption-b", ctaVariantVersion: "v1", destinationId: null, destinationDefinitionVersion: null, nativeTarget: "CURRENT_PUBLICATION", channelId: "TG", occurrenceId: "1" });
  assert.equal(a.materialId, b.materialId);
  assert.notEqual(a.ctaVariantId, b.ctaVariantId);
  assert.equal(new Set([baseMaterial.baseAssetId]).size, 1);
});

test("CO-S3-T05: HTTP 200 evidence alone cannot become VERIFIED_READY", () => {
  const evaluated = cta.evaluateCtaDestination({ variant: resourceVariant(), destination: articleDestination(), readinessEvidence: verifiedEvidence({ evidenceType: "HTTP_ONLY", promisedOutcomeMatches: null, requiredQaPassed: null }) });
  assert.equal(evaluated.destinationReadiness, "UNKNOWN");
  assert.notEqual(evaluated.ctaDestinationGate, "PASS");
});

test("CO-S3-T06: admin-only access does not pass audience readiness", () => {
  const evaluated = cta.evaluateCtaDestination({ variant: resourceVariant(), destination: articleDestination(), readinessEvidence: verifiedEvidence({ audienceAccessible: false }) });
  assert.equal(evaluated.destinationReadiness, "NOT_READY");
  assert.equal(evaluated.ctaDestinationGate, "BLOCKED");
});

test("CO-S3-T07: v1 evidence never transfers automatically to destination v2", () => {
  const evaluated = cta.evaluateCtaDestination({ variant: resourceVariant({ destinationDefinitionVersion: "v2" }), destination: articleDestination({ definitionVersion: "v2" }), readinessEvidence: verifiedEvidence({ definitionVersion: "v1" }) });
  assert.equal(evaluated.destinationReadiness, "RECHECK_REQUIRED");
  assert.equal(evaluated.ctaDestinationGate, "BLOCKED");
});

test("CO-S3-T08: manual QA can pass; Sheet Ready label alone cannot", () => {
  const valid = cta.evaluateCtaDestination({ variant: resourceVariant(), destination: articleDestination(), readinessEvidence: verifiedEvidence() });
  const label = cta.evaluateCtaDestination({ variant: resourceVariant(), destination: articleDestination(), readinessEvidence: verifiedEvidence({ evidenceType: "SHEET_LABEL_ONLY", source: "SHEET_CONFIG" }) });
  assert.equal(valid.ctaDestinationGate, "PASS");
  assert.equal(label.destinationReadiness, "UNKNOWN");
});

test("CO-S3-T09: destination PASS does not claim creative/release readiness", () => {
  const evaluated = cta.evaluateCtaDestination({ variant: resourceVariant(), destination: articleDestination(), readinessEvidence: verifiedEvidence(), otherChecks: "NOT_EVALUATED" });
  assert.equal(evaluated.ctaDestinationGate, "PASS");
  assert.equal(evaluated.otherChecks, "NOT_EVALUATED");
  assert.equal(evaluated.executionAllowed, false);
});

test("CO-S3-T11: unknown/unsupported native capability has diagnostic and no fallback", () => {
  const unknown = cta.evaluateCtaDestination({ variant: baseVariant(), nativeCapability: { ...nativeCapability(), supported: null } });
  const unsupported = cta.evaluateCtaDestination({ variant: baseVariant(), nativeCapability: nativeCapability("SAVE", false) });
  assert.equal(unknown.ctaDestinationGate, "UNKNOWN");
  assert.equal(unsupported.ctaDestinationGate, "BLOCKED");
  assert.equal(unknown.diagnostics[0].code, "NATIVE_CAPABILITY_UNKNOWN");
});

test("CO-S3-T12: source approval does not invent a public URL dependency for FOLLOW", () => {
  const item = material("demo:cp070:b:short");
  assert.equal(item.sourceArticleVersion, "demo-v1");
  assert.equal(item.sourcePublicUrlRequired, false);
  assert.equal(item.evaluation.ctaDestinationGate, "PASS");
  assert.equal(item.binding.destinationId, null);
});

test("CO-S3-T13: YouTube NO disables only long path", () => {
  const items = cta.applyLongVideoDecision([{ id: "long", formatCode: "LONG_VIDEO" }, { id: "short", formatCode: "SHORT_VIDEO" }, { id: "post", formatCode: "YOUTUBE_POST" }], "NO");
  assert.equal(items.find((item) => item.id === "long").youtubeState, "NOT_APPLICABLE");
  assert.ok(items.filter((item) => item.id !== "long").every((item) => item.youtubeState === "INDEPENDENT"));
});

test("CO-S3-T14: YouTube decision pinned to source v1 is not rewritten by v2", () => {
  const decision = { decision: "YES", sourceArticleId: "article-a", sourceArticleVersion: "v1", reasonUz: "Demo" };
  const impact = cta.evaluateYoutubeSourceImpact(decision, { sourceArticleId: "article-a", version: "v2" });
  assert.equal(impact.state, "PINNED_SOURCE_STALE");
  assert.equal(impact.pinnedVersion, "v1");
  assert.equal(impact.hiddenRewrite, false);
});

test("CO-S3-T15: broken destination returns read-only impact; platform state and writers stay untouched", () => {
  const references = [
    { referenceId: "i1", destinationId: "TL-024", destinationDefinitionVersion: "v1", materialId: "m1", ctaVariantId: "c1", state: "SCHEDULED" },
    { referenceId: "i2", destinationId: "TL-024", destinationDefinitionVersion: "v1", materialId: "m2", ctaVariantId: "c2", state: "PUBLISHED" },
  ];
  const before = structuredClone(references);
  const impact = cta.calculateDestinationImpact({ destinationId: "TL-024", destinationDefinitionVersion: "v1", readiness: "NOT_READY", references, runtimeProjectionAvailable: true });
  assert.deepEqual(references, before);
  assert.equal(impact.externalActionsPerformed, 0);
  assert.equal(impact.affected.length, 2);
  assert.deepEqual(impact.affected.map((item) => item.state), ["SCHEDULED", "PUBLISHED"]);
});

test("CO-S3-T16: URL move requires definition revision/recheck, never automatic reshoot", () => {
  const previous = articleDestination();
  const next = articleDestination({ definitionVersion: "v2", configuredUrl: "https://fixture.invalid/new-article" });
  const impact = cta.evaluateDestinationDefinitionChange({ previous, next });
  assert.equal(impact.definitionRevisionRequired, true);
  assert.equal(impact.routeRecheckRequired, true);
  assert.equal(impact.creativeReviewRequired, false);
  assert.equal(impact.automaticReshootRequired, false);
});

test("CO-S3-T17: apply flags cannot bypass server guard and every writer remains zero", () => {
  const calls = { task: 0, migration: 0, notification: 0, schedule: 0, publish: 0, ads: 0 };
  const rejection = rejectCatalogPreviewMutation({ apply: true, dryRun: false }, {
    taskWriter: () => { calls.task++; }, migrationWriter: () => { calls.migration++; }, notificationWriter: () => { calls.notification++; }, scheduleWriter: () => { calls.schedule++; }, publishWriter: () => { calls.publish++; }, adsWriter: () => { calls.ads++; },
  });
  assert.equal(rejection.status, 503);
  assert.equal(rejection.body.code, "CO_S2_PREVIEW_ONLY");
  assert.deepEqual(calls, { task: 0, migration: 0, notification: 0, schedule: 0, publish: 0, ads: 0 });
});

test("CO-S3-T18: regression snapshot and CP-070 demo origins stay separate", () => {
  const snapshot = buildRealSnapshotRegressionPreview();
  const fixture = demo();
  assert.equal(snapshot.packageItems.length, 11);
  assert.ok(snapshot.packageItems.every((item) => item.approvalStatusRaw === "Taklif" && item.active === false));
  assert.equal(snapshot.metrics.backendRealTaskCount, null);
  assert.equal(fixture.origin, "DEMO_CP070");
  assert.notEqual(snapshot.sourceSnapshot.spreadsheetId, fixture.fixtureId);
});

test("CO-S3-T19: public serializer is allowlist-only and strips private evidence", () => {
  const payload = cta.serializePublicCtaProjection([
    { materialId: "draft", materialVersion: "v1", title: "Draft title", publicUrl: "/draft", primaryCta: "USE_TOOL", destinationUrl: "/tool", publicationEvidence: "UNKNOWN", visibility: "PRIVATE", employeeId: "e1", readinessEvidence: { checkedBy: "secret" }, telegramId: "1", taskNotes: "secret" },
    { materialId: "published", materialVersion: "v2", title: "Public title", publicUrl: "https://example.com/a", primaryCta: "SAVE", destinationUrl: null, publicationEvidence: "VERIFIED", visibility: "ALLOWLISTED", employeeId: "e2", readinessEvidence: { checkedBy: "private" }, secret: "x" },
  ]);
  assert.deepEqual(payload, [{ materialId: "published", materialVersion: "v2", title: "Public title", publicUrl: "https://example.com/a", primaryCta: "SAVE", destinationUrl: null }]);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("employee"), false);
  assert.equal(serialized.includes("evidence"), false);
  assert.equal(serialized.includes("secret"), false);
});

test("CO-S3-T20: Draft/role/forecast guards remain unchanged", () => {
  const snapshot = buildRealSnapshotRegressionPreview();
  assert.ok(snapshot.workflowPreviews.every((workflow) => workflow.executable === false));
  assert.equal(adapter.validateContentAssignment({ requiredRole: "Digital marketer", candidateEmployeeId: "ROLE-DIGITAL", candidateRole: "Digital marketer", recordType: "ROLE_PLACEHOLDER" }).code, "ROLE_PLACEHOLDER_NOT_IDENTITY");
  const dataset = { items: [{ productionId: "locked", targetPublishDate: "2026-10-02", scheduleLocked: true }], settings: [{ key: "DEFAULT_REVIEW_DAYS", value: "1", active: true }], team: [], workflow: [], publishingRules: [], holidays: [] };
  const before = structuredClone(dataset);
  const simulated = applyScheduleOverrides(dataset, { settings: { DEFAULT_REVIEW_DAYS: "2" } });
  assert.deepEqual(dataset, before);
  assert.equal(simulated.items[0].targetPublishDate, dataset.items[0].targetPublishDate);
});
