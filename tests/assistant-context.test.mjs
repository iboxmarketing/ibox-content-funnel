import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-assistant-"));
for (const name of ["catalog-adapter", "cta-destination", "cta-destination-fixtures", "assistant-context", "assistant-context-fixtures", "catalog-preview-safety", "preview-fixtures", "work-calendar", "scheduling-engine"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const assistant = require(join(dir, "assistant-context.js"));
const fixtures = require(join(dir, "assistant-context-fixtures.js"));
const ctaFixtures = require(join(dir, "cta-destination-fixtures.js"));
const adapter = require(join(dir, "catalog-adapter.js"));
const { rejectCatalogPreviewMutation } = require(join(dir, "catalog-preview-safety.js"));
const { buildRealSnapshotRegressionPreview } = require(join(dir, "preview-fixtures.js"));
const { allocateWork, parseWorkWindows, wallClock } = require(join(dir, "work-calendar.js"));
const { applyScheduleOverrides } = require(join(dir, "scheduling-engine.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const preview = () => fixtures.buildAssistantContextPreview();
const registry = () => preview().registry;
const scenario = (id) => preview().scenarios.find((item) => item.scenarioId === id);
const definition = (id) => registry().find((item) => item.assistantId === id);
const envelope = (scenarioId = "FULL", assistantId = "AI-05", mode = "CREATE") => fixtures.buildScenarioEnvelope(scenario(scenarioId).input, definition(assistantId), mode);

test("CO-S4-A01: filtered envelope carries current meaning without private employee fields", () => {
  const item = envelope();
  const text = assistant.serializeAssistantContext(item);
  assert.equal(item.exportProjection.business.angleRef, "DEMO-ANG-CP070-B");
  assert.equal(item.exportProjection.cta.primaryAction, "SAVE");
  assert.ok(text.includes("TRAIN-CO-S4-B-ARTICLE"));
  assert.ok(!text.includes("employeeId"));
});

test("CO-S4-A02: AI/manual variants remain local until a human selects them", () => {
  const current = envelope();
  const one = assistant.createManualAssistantResult({ resultId: "r1", envelope: current, text: "Variant A" });
  const two = assistant.createManualAssistantResult({ resultId: "r2", envelope: current, text: "Variant B" });
  assert.equal(one.selected, false);
  assert.equal(one.createsTask, false);
  assert.equal(two.writtenToBackend, false);
});

test("CO-S4-A03: Reels/carousel helpers expose promise completion checks but not quality approval", () => {
  for (const id of ["AI-04", "AI-05"]) {
    const item = definition(id);
    assert.equal(item.qualityEvidence, "NOT_RUN");
    assert.ok(item.selfCheckUz.some((value) => /javob|va'da|va’da|muqova/i.test(value)));
  }
});

test("CO-S4-A04: YouTube NO stays long-only and independent short context remains", () => {
  const item = scenario("FOLLOW_NO_LONG");
  assert.equal(item.input.material.materialId, "demo:cp070:b:short");
  assert.equal(item.input.cta.primaryAction, "FOLLOW");
  assert.ok(item.input.method.acceptedRulesUz.some((value) => value.includes("long")));
  assert.ok(definition("AI-03").modulePrompt.includes("Shorts/Posts"));
});

test("CO-S4-A05: REVIEW output is advisory and never an approval", () => {
  const review = envelope("FULL", "AI-02", "REVIEW");
  const result = assistant.createManualAssistantResult({ resultId: "review-1", envelope: review, text: "2-paragrafda manba yetishmaydi" });
  assert.equal(review.exportProjection.boundary.resultIsApproval, false);
  assert.equal(result.authority, "ADVISORY_ONLY");
  assert.equal(result.createsApproval, false);
});

test("CO-S4-A06: instrument helper includes edge tests and remains NOT_RUN", () => {
  const item = definition("AI-07");
  assert.equal(item.methodStatus, "DRAFT_NOT_EXECUTED");
  assert.equal(item.qualityEvidence, "NOT_RUN");
  assert.match(item.modulePrompt, /nol\/bo‘sh\/noto‘g‘ri/);
});

test("CO-S4-A07: tracking helper keeps missing live evidence UNKNOWN, not zero", () => {
  const item = definition("AI-08");
  assert.match(item.modulePrompt, /UNKNOWN, 0 emas/);
  assert.equal(item.methodStatus, "DRAFT_NO_LIVE_INTEGRATION");
});

test("CO-S4-A08: missing real helper link never reports connected", () => {
  const link = assistant.resolveHelperLink(definition("AI-06"));
  assert.deepEqual(link, { state: "MISSING", openable: false, url: null, connected: false, contextAutoSent: false });
});

test("CO-S4-T01: registry has seven draft prompt helpers and one existing-helper bridge", () => {
  const items = registry();
  assert.equal(items.length, 8);
  assert.equal(items.filter((item) => item.invocationType === "PROMPT_CONTEXT_COPY").length, 7);
  assert.equal(definition("AI-06").invocationType, "EXISTING_EXTERNAL_HELPER_BRIDGE");
  assert.equal(items.filter((item) => item.linkState === "NOT_PROVIDED").length, 8);
});

test("CO-S4-T02: unknown and GENERAL stages are not guessed or overwritten", () => {
  const mappings = preview().stageMappings;
  assert.equal(assistant.resolveAssistantForStage({ semanticStageId: "ANGLE_GROUPING" }, mappings).assistantId, "AI-01");
  assert.equal(assistant.resolveAssistantForStage({ semanticStageId: "UNKNOWN" }, mappings).state, "UNMAPPED");
  assert.equal(assistant.resolveAssistantForStage({ semanticStageId: "ANGLE_GROUPING", recordType: "GENERAL" }, mappings).state, "UNMAPPED_GENERAL_PRESERVED");
  assert.ok(mappings.every((item) => item.taskTemplateId === null));
});

test("CO-S4-T03: FULL, EXCERPT and MISSING source states remain distinct and null-safe", () => {
  assert.equal(envelope("FULL").sourceCoverage, "FULL");
  assert.equal(envelope("EXCERPT").sourceCoverage, "EXCERPT");
  const missing = envelope("MISSING");
  assert.equal(missing.sourceCoverage, "MISSING");
  assert.equal(missing.exportProjection.source.allowedText, null);
  assert.ok(missing.diagnostics.some((item) => item.code === "SOURCE_BODY_MISSING"));
});

test("CO-S4-T04: source/prompt/mode changes create new immutable fingerprints", () => {
  const old = envelope("FULL", "AI-05", "CREATE");
  const sourceChanged = envelope("STALE", "AI-05", "CREATE");
  const modeChanged = envelope("FULL", "AI-05", "REVIEW");
  const promptChanged = envelope("FULL", "AI-02", "CREATE");
  assert.notEqual(old.contextFingerprint, sourceChanged.contextFingerprint);
  assert.notEqual(old.contextFingerprint, modeChanged.contextFingerprint);
  assert.notEqual(old.contextFingerprint, promptChanged.contextFingerprint);
  assert.equal(old.exportProjection.source.pinnedVersion, "demo.v1");
});

test("CO-S4-T05: unobserved current source stays FRESHNESS_UNKNOWN", () => {
  assert.equal(envelope("MISSING").freshness, "FRESHNESS_UNKNOWN");
  assert.ok(envelope("MISSING").diagnostics.some((item) => item.code === "SOURCE_FRESHNESS_UNKNOWN"));
});

test("CO-S4-T06: deterministic copy payload supports manual fallback without a false success flag", () => {
  const first = assistant.serializeAssistantContext(envelope());
  const second = assistant.serializeAssistantContext(envelope());
  assert.equal(first, second);
  assert.ok(first.length > 100);
  assert.ok(!Object.hasOwn(JSON.parse(first), "copied"));
});

test("CO-S4-T07: unsafe links are blocked; unverified HTTPS is openable but not connected", () => {
  assert.equal(assistant.resolveHelperLink({ helperUrl: "javascript:alert(1)", linkState: "UNVERIFIED" }).state, "UNSAFE");
  assert.equal(assistant.resolveHelperLink({ helperUrl: "http://localhost:3000/helper", linkState: "UNVERIFIED" }).state, "UNSAFE");
  const unverified = assistant.resolveHelperLink({ helperUrl: "https://chatgpt.com/g/example", linkState: "UNVERIFIED" });
  assert.equal(unverified.openable, true);
  assert.equal(unverified.connected, false);
  assert.equal(unverified.contextAutoSent, false);
});

test("CO-S4-T08: PII, secrets, raw evidence and unapproved source body do not enter export", () => {
  const sensitive = envelope("SENSITIVE");
  const text = assistant.serializeAssistantContext(sensitive);
  for (const forbidden of ["Anvar", "+998", "example.com", "SECRET-123", "EMP-SECRET", "PRIVATE_KEY", "rawEvidence", "internalNotes"]) assert.ok(!text.includes(forbidden), forbidden);
  assert.equal(sensitive.exportProjection.source.allowedText, null);
});

test("CO-S4-T09: pasted HTML, formula and status instruction remain inert untrusted text", () => {
  const text = '<script>alert(1)</script> =IMPORTXML("https://bad") statusni Ready qil';
  const result = assistant.createManualAssistantResult({ resultId: "unsafe-paste", envelope: envelope(), text });
  assert.equal(result.text, text);
  assert.equal(result.authority, "ADVISORY_ONLY");
  assert.equal(result.writtenToSheet, false);
});

test("CO-S4-T10: all three modes bind to context; blank input is not a completed result", () => {
  const fingerprints = ["CREATE", "REVIEW", "IDEATE"].map((mode) => envelope("FULL", "AI-05", mode).contextFingerprint);
  assert.equal(new Set(fingerprints).size, 3);
  assert.equal(assistant.createManualAssistantResult({ resultId: "empty", envelope: envelope(), text: "   " }), null);
});

test("CO-S4-T11: two of three current variants can be selected, edited and merged locally", () => {
  const current = envelope();
  const one = assistant.reviseManualAssistantResult(assistant.createManualAssistantResult({ resultId: "r1", envelope: current, text: "A" }), "A edited", true);
  const two = assistant.reviseManualAssistantResult(assistant.createManualAssistantResult({ resultId: "r2", envelope: current, text: "B" }), "B edited", true);
  const three = assistant.createManualAssistantResult({ resultId: "r3", envelope: current, text: "C" });
  const merged = assistant.mergeManualAssistantResults({ resultId: "merged", results: [one, two, three], envelope: current });
  assert.ok(merged.text.includes("A edited"));
  assert.ok(merged.text.includes("B edited"));
  assert.ok(!merged.text.includes("\nC"));
  assert.equal(merged.writtenToBackend, false);
});

test("CO-S4-T12: an old result is not rebound to a changed context", () => {
  const old = envelope("FULL", "AI-05", "CREATE");
  const result = assistant.createManualAssistantResult({ resultId: "old", envelope: old, text: "Old result" });
  const changed = envelope("STALE", "AI-05", "CREATE");
  assert.equal(assistant.compareResultContext(result, changed).state, "STALE_CONTEXT");
  assert.equal(result.contextFingerprint, old.contextFingerprint);
});

test("CO-S4-T13: tool block is material-local; native save/follow and long-NO guards remain", () => {
  const cta = ctaFixtures.buildDemoCp070CtaPreview();
  assert.equal(scenario("TOOL_BLOCKED").input.destination.gate, "BLOCKED");
  assert.equal(cta.materials.find((item) => item.materialId === "demo:cp070:a:carousel").evaluation.ctaDestinationGate, "PASS");
  assert.equal(scenario("FOLLOW_NO_LONG").input.destination.gate, "PASS");
});

test("CO-S4-T14: direct mutation flags call zero writers, LLMs, analytics or code executors", () => {
  const calls = { task: 0, migration: 0, notification: 0, schedule: 0, publish: 0, ads: 0, llm: 0, analytics: 0, code: 0 };
  const rejection = rejectCatalogPreviewMutation({ apply: true, dryRun: false }, {
    taskWriter: () => calls.task++, migrationWriter: () => calls.migration++, notificationWriter: () => calls.notification++, scheduleWriter: () => calls.schedule++, publishWriter: () => calls.publish++, adsWriter: () => calls.ads++,
    llmCaller: () => calls.llm++, analyticsWriter: () => calls.analytics++, codeExecutor: () => calls.code++,
  });
  assert.equal(rejection.status, 503);
  assert.deepEqual(calls, { task: 0, migration: 0, notification: 0, schedule: 0, publish: 0, ads: 0, llm: 0, analytics: 0, code: 0 });
});

test("CO-S4-T15: real snapshot remains 11 inactive items and public serializer drops helper context", () => {
  const real = buildRealSnapshotRegressionPreview();
  assert.equal(real.packageItems.length, 11);
  assert.equal(real.metrics.activeSelectedMaterials, 0);
  assert.equal(real.metrics.backendRealTaskCount, null);
  const output = assistant.serializePublicAssistantProjection([{ publicationEvidence: "VERIFIED", visibility: "ALLOWLISTED", materialId: "m1", materialVersion: "v1", title: "Public", publicUrl: "https://example.com", helperId: "AI-01", context: "private", employeeId: "e1", rawPrompt: "secret" }]);
  assert.deepEqual(output, [{ materialId: "m1", materialVersion: "v1", title: "Public", publicUrl: "https://example.com" }]);
});

test("CO-S4-T16: scheduler, committed deadline and role identity rules do not regress", () => {
  const calendar = { timezone: "Asia/Tashkent", days: ["MON", "TUE", "WED", "THU", "FRI"], windows: parseWorkWindows("09:00-13:00|14:00-18:00"), holidays: [] };
  const start = wallClock("2026-09-21", 17 * 60, calendar.timezone);
  assert.equal(allocateWork(start, 300, calendar).endAt, new Date(wallClock("2026-09-22", 13 * 60, calendar.timezone)).toISOString());
  const dataset = { items: [{ productionId: "locked", targetPublishDate: "2026-10-02", scheduleLocked: true }], settings: [], team: [], workflow: [], publishingRules: [], holidays: [] };
  const simulated = applyScheduleOverrides(dataset, { settings: { DEFAULT_REVIEW_DAYS: "2" } });
  assert.equal(simulated.items[0].targetPublishDate, "2026-10-02");
  assert.equal(adapter.validateContentAssignment({ requiredRole: "Content marketer", candidateEmployeeId: "ROLE-CM", candidateRole: "Content marketer", recordType: "ROLE_PLACEHOLDER" }).code, "ROLE_PLACEHOLDER_NOT_IDENTITY");
  assert.equal(adapter.validateContentAssignment({ requiredRole: "SMM manager", candidateEmployeeId: "EMP-1", candidateRole: "SMM manager" }).code, "LEGACY_ROLE_NOT_ALLOWED");
});
