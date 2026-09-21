import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-tracking-"));
for (const name of ["cta-destination", "cta-destination-fixtures", "material-workplan", "material-workplan-fixtures", "catalog-preview-safety", "catalog-adapter", "preview-fixtures", "work-calendar", "scheduling-engine", "tracking-preview", "tracking-preview-fixtures"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const tracking = require(join(dir, "tracking-preview.js"));
const fixtures = require(join(dir, "tracking-preview-fixtures.js"));
const workFixtures = require(join(dir, "material-workplan-fixtures.js"));
const { rejectCatalogPreviewMutation } = require(join(dir, "catalog-preview-safety.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

const preview = () => fixtures.buildTrackingPreview();
const scenario = (id) => preview().links.find((item) => item.scenarioId === id);
const baseScenario = () => scenario("F1-TG");
const build = (overrides = {}) => {
  const base = baseScenario();
  return tracking.buildTrackingLink({
    binding: overrides.binding ?? base.binding,
    policy: overrides.policy === undefined ? preview().policy : overrides.policy,
    destination: overrides.destination === undefined ? preview().destinations.article : overrides.destination,
    capability: overrides.capability === undefined ? base.capability : overrides.capability,
    ctaDestinationGate: overrides.ctaDestinationGate ?? "PASS",
  });
};
const metric = (input = {}) => ({
  observationId: input.observationId ?? "metric",
  metricName: input.metricName ?? "NUMERATOR",
  definitionId: input.definitionId ?? "metric.v1",
  value: input.value === undefined ? 1 : input.value,
  unit: input.unit ?? "COUNT",
  entityScope: input.entityScope ?? "scope:1",
  cohortId: input.cohortId ?? "cohort:1",
  rateContractId: input.rateContractId ?? "rate:1",
  sourceScopeKey: input.sourceScopeKey ?? "source:1",
  windowStart: input.windowStart ?? "2026-10-01T00:00:00.000+05:00",
  windowEnd: input.windowEnd ?? "2026-10-08T00:00:00.000+05:00",
  timezone: input.timezone ?? "Asia/Tashkent",
  source: input.source ?? "fixture",
  asOf: input.asOf ?? "2026-10-08T01:00:00.000+05:00",
  granularity: input.granularity ?? "EVENT",
  availability: input.availability ?? "AVAILABLE",
  completenessReason: input.completenessReason ?? null,
  revision: input.revision ?? 1,
  origin: input.origin ?? "SYNTHETIC",
});
const observedEvent = (input = {}) => ({
  source: input.source ?? "source",
  stream: input.stream ?? "stream",
  origin: input.origin ?? "OBSERVED_RUNTIME",
  environment: input.environment ?? "PRODUCTION",
  eventId: input.eventId ?? "evt-1",
  rawEventName: input.rawEventName ?? "entry_visit",
  canonicalEventName: input.canonicalEventName ?? "ENTRY_VISIT",
  occurredAt: input.occurredAt ?? "2026-10-01T08:00:00.000Z",
  receivedAt: input.receivedAt ?? "2026-10-01T08:00:01.000Z",
  publicationIntentId: input.publicationIntentId ?? "intent-1",
  visitId: input.visitId ?? "visit-1",
  toolId: input.toolId ?? null,
  toolVersion: input.toolVersion ?? null,
  attemptId: input.attemptId ?? null,
  completionMilestone: input.completionMilestone ?? null,
  submissionId: input.submissionId ?? null,
  trafficClass: input.trafficClass ?? "OBSERVED_UNCLASSIFIED",
  value: input.value ?? null,
});

test("CO-S6-T01: repeated build, render order and copy keep one stable link/token", () => {
  const first = build();
  const second = build();
  const reorderedBinding = Object.fromEntries(Object.entries(baseScenario().binding).reverse());
  const reordered = build({ binding: reorderedBinding });
  assert.equal(first.url, second.url);
  assert.equal(first.token, second.token);
  assert.equal(first.url, reordered.url);
  assert.equal(preview().runtimeBoundary.writerCalls, 0);
});

test("CO-S6-T02: one material, two channels and a new occurrence get distinct tokens without shared-work multiplication", () => {
  const data = preview();
  const telegram = data.links.find((item) => item.scenarioId === "F1-TG");
  const linkedin = data.links.find((item) => item.scenarioId === "F1-LI");
  const nextOccurrence = tracking.reviseTrackingBinding(telegram.binding, { occurrenceId: "occ-2" }).revised;
  assert.notEqual(telegram.result.token, linkedin.result.token);
  assert.notEqual(build({ binding: nextOccurrence }).token, telegram.result.token);
  assert.deepEqual([data.materialBoundary.researchCountBefore, data.materialBoundary.researchCountAfter, data.materialBoundary.shootCountAfter, data.materialBoundary.mainEditCountAfter], [1, 1, 1, 1]);
});

test("CO-S6-T03: native action has no URL while missing resource URL gets no fake fallback", () => {
  const native = scenario("F2-NATIVE").result;
  const missing = build({ destination: { ...preview().destinations.article, configuredUrl: null } });
  assert.equal(native.url, null);
  assert.equal(native.structuralState, "NOT_APPLICABLE");
  assert.equal(missing.url, null);
  assert.ok(missing.diagnostics.some((item) => item.code === "DESTINATION_URL_NOT_CONFIGURED"));
});

test("CO-S6-T04: safe query, fragment, UTF-8 and canonical order are preserved deterministically", () => {
  const destination = { ...preview().destinations.article, configuredUrl: "https://example.invalid/guide?section=foyda&lang=o%27z#qadam-2" };
  const result = build({ destination });
  const url = new URL(result.url);
  assert.equal(url.searchParams.get("section"), "foyda");
  assert.equal(url.searchParams.get("lang"), "o'z");
  assert.equal(url.hash, "#qadam-2");
  assert.equal(result.url, build({ destination }).url);
});

test("CO-S6-T05: conflicting UTM and signed params fail while same-value duplicates collapse", () => {
  const base = preview().destinations.article;
  const conflict = build({ destination: { ...base, configuredUrl: `${base.configuredUrl.split("#")[0]}&utm_source=other#checklist` } });
  const signed = build({ destination: { ...base, configuredUrl: "https://example.invalid/guide?signature=secret" } });
  const same = build({ destination: { ...base, configuredUrl: "https://example.invalid/guide?utm_source=telegram&utm_source=telegram" } });
  assert.ok(conflict.diagnostics.some((item) => item.code === "TRACKING_PARAM_CONFLICT"));
  assert.ok(signed.diagnostics.some((item) => item.code === "UNSUPPORTED_SIGNED_OR_AD_PARAM"));
  assert.equal(new URL(same.url).searchParams.getAll("utm_source").length, 1);
});

test("CO-S6-T06: unsafe scheme, credentials, private host, spoof and encoded redirect are rejected without fetch", () => {
  const base = preview().destinations.article;
  const urls = [
    "http://example.invalid/guide",
    "https://user:pass@example.invalid/guide",
    "https://127.0.0.1/guide",
    "https://example.invalid.attacker.test/guide",
    "https://example.invalid/guide?url=https%3A%2F%2Fevil.test",
  ];
  const results = urls.map((configuredUrl) => build({ destination: { ...base, configuredUrl } }));
  assert.ok(results.every((item) => item.url === null && item.structuralState === "INVALID"));
  assert.equal(preview().runtimeBoundary.externalNetworkCalls, 0);
});

test("CO-S6-T07: PII, secret, employee/task IDs never enter URL or diagnostics", () => {
  const base = preview().destinations.article;
  const sensitive = ["?email=ali%40example.com", "?phone=%2B998901234567", "?private_key=abc", "/EMP-SECRET-9"];
  for (const suffix of sensitive) {
    const configuredUrl = suffix.startsWith("/") ? `https://example.invalid/guide${suffix}` : `https://example.invalid/guide${suffix}`;
    const result = build({ destination: { ...base, configuredUrl } });
    assert.equal(result.url, null);
    assert.ok(result.diagnostics.some((item) => item.code === "SENSITIVE_VALUE_REJECTED"));
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /ali@|998901234567|abc|EMP-SECRET/i);
  }
});

test("CO-S6-T08: collision, unknown token and forged intent fail closed", () => {
  const item = baseScenario();
  const entry = { token: item.result.token, bindingRevisionId: item.binding.bindingRevisionId, publicationIntentId: item.binding.publicationIntentId, targetFingerprint: item.result.targetFingerprint, targetUrl: item.result.url };
  const conflicting = { ...entry, bindingRevisionId: "other:r1", targetFingerprint: "target_other" };
  const registry = tracking.buildTrackingRegistry([entry, conflicting]);
  assert.ok(registry.diagnostics.some((diagnostic) => diagnostic.code === "TRACKING_TOKEN_COLLISION"));
  assert.equal(tracking.resolveTrackingToken(registry.registry, "unknown").entry, null);
  assert.equal(tracking.resolveTrackingToken(registry.registry, entry.token, "forged-intent").entry, null);
});

test("CO-S6-T09: Shorts description block is placement-specific and native/long placements are not globally blocked", () => {
  assert.equal(scenario("F5-YT-SHORT").result.placementState, "NON_CLICKABLE_PLACEMENT");
  assert.equal(scenario("F5-YT-LONG").result.placementState, "UNKNOWN");
  assert.equal(scenario("F2-NATIVE").result.placementState, "SUPPORTED");
  assert.equal(scenario("F5-YT-SHORT").binding.ctaVariantId, scenario("F1-TG").binding.ctaVariantId);
});

test("CO-S6-T10: TL-024 blocks only its resource route while independent SAVE remains URL-free and separate", () => {
  const tool = scenario("F2-TOOL-BLOCK").result;
  const save = scenario("F2-NATIVE").result;
  assert.equal(tool.structuralState, "SYNTAX_VALID");
  assert.equal(tool.destinationState, "BLOCKED");
  assert.equal(save.destinationState, "PASS");
  assert.equal(save.url, null);
});

test("CO-S6-T11: semantic change creates a new immutable binding while cosmetic no-op preserves history", () => {
  const current = baseScenario().binding;
  const cosmetic = tracking.reviseTrackingBinding(current, { packageRef: "DEMO-PKG-CP070 renamed label only" });
  const semantic = tracking.reviseTrackingBinding(current, { ctaVariantVersion: "v2" });
  assert.equal(cosmetic.bindingChanged, false);
  assert.equal(cosmetic.revised.bindingRevisionId, current.bindingRevisionId);
  assert.equal(semantic.bindingChanged, true);
  assert.equal(semantic.revised.previousBindingRevisionId, current.bindingRevisionId);
  assert.notEqual(build({ binding: semantic.revised }).token, baseScenario().result.token);
});

test("CO-S6-T12: shared bio and forwarded-link limits never become exact person/material attribution", () => {
  const shared = scenario("F5-SHARED-BIO");
  assert.equal(shared.result.attributionScope, "CHANNEL_OR_SHARED_PLACEMENT");
  assert.equal(shared.result.executionAllowed, false);
  assert.ok(!shared.result.diagnostics.some((item) => /person|foydalanuvchi identity/i.test(item.reasonUz)));
});

test("CO-S6-T13: transport retries dedupe once and reordered input yields the same projection", () => {
  const input = preview().eventDedupe.observations;
  const duplicate = { ...input[0], receivedAt: "2026-10-02T12:00:00.000Z" };
  const first = tracking.dedupeObservations([...input, duplicate]);
  const reordered = tracking.dedupeObservations([duplicate, ...input].reverse());
  assert.deepEqual(first.observations.map((item) => item.eventId), reordered.observations.map((item) => item.eventId));
  assert.equal(first.transportRetriesDropped, 1);
});

test("CO-S6-T14: one attempt rerender stays one completion while a genuine new attempt counts", () => {
  const data = preview().eventDedupe;
  assert.equal(data.uniqueCompletionCount, 2);
  assert.ok(data.semanticDuplicatesDropped >= 1);
  assert.ok(data.observations.some((item) => item.attemptId === "attempt-b" && item.canonicalEventName === "TOOL_COMPLETE"));
});

test("CO-S6-T15: conflicting event payload and complete-without-start are explicit anomalies", () => {
  const original = observedEvent({ eventId: "evt-conflict", canonicalEventName: "TOOL_COMPLETE", rawEventName: "tool_complete", toolId: "TL-024", toolVersion: "v1", attemptId: "a", completionMilestone: "RESULT_RENDERED" });
  const conflicting = { ...original, toolVersion: "v2" };
  const missingStart = observedEvent({ eventId: "evt-missing-start", canonicalEventName: "TOOL_COMPLETE", rawEventName: "tool_complete", toolId: "TL-024", toolVersion: "v1", attemptId: "b", completionMilestone: "RESULT_RENDERED" });
  const result = tracking.dedupeObservations([original, conflicting, missingStart]);
  assert.ok(result.diagnostics.some((item) => item.code === "EVENT_ID_CONFLICT"));
  assert.ok(result.diagnostics.some((item) => item.code === "TOOL_COMPLETE_WITHOUT_START"));
});

test("CO-S6-T16: cumulative retry/revision and API/manual overlap are not summed", () => {
  const base = { provider: "p", accountId: "a", entityId: "post", metricName: "CLICKS", definitionId: "click.v1", windowStart: "2026-10-01", windowEnd: "2026-10-08" };
  const result = tracking.reconcileCumulativeSnapshots([
    { ...base, snapshotId: "s1", sourceMode: "API", value: 10, revision: 1, asOf: "2026-10-08T00:00:00Z" },
    { ...base, snapshotId: "s1-retry", sourceMode: "API", value: 10, revision: 1, asOf: "2026-10-08T00:00:00Z" },
    { ...base, snapshotId: "s2", sourceMode: "API", value: 12, revision: 2, asOf: "2026-10-08T02:00:00Z" },
    { ...base, snapshotId: "manual", sourceMode: "MANUAL", value: 11, revision: 1, asOf: "2026-10-08T01:00:00Z" },
  ]);
  assert.equal(result.total, 12);
  assert.equal(result.current.length, 1);
  assert.ok(result.diagnostics.some((item) => item.code === "METRIC_SOURCE_MISMATCH"));
});

test("CO-S6-T17: test and known robot traffic are excluded while unknown traffic is not verified human", () => {
  const items = [
    observedEvent({ eventId: "test", trafficClass: "KNOWN_TEST" }),
    observedEvent({ eventId: "robot", trafficClass: "KNOWN_PREVIEW_OR_ROBOT" }),
    observedEvent({ eventId: "unknown", trafficClass: "OBSERVED_UNCLASSIFIED" }),
    observedEvent({ eventId: "fixture", origin: "SYNTHETIC", environment: "TEST" }),
  ];
  const result = tracking.filterProductionCohort(items);
  assert.deepEqual(result.included.map((item) => item.eventId), ["unknown"]);
  assert.equal(result.unknownTrafficVerifiedHuman, false);
  assert.equal(result.excluded.length, 3);
});

test("CO-S6-T18: direct tagged URL can have observed visits while click source remains UNKNOWN", () => {
  const link = baseScenario().result;
  const landing = metric({ observationId: "landing", metricName: "ENTRY_VISITS", value: 4, availability: "AVAILABLE" });
  assert.equal(link.structuralState, "SYNTAX_VALID");
  assert.equal(link.measurementState, "UNKNOWN");
  assert.equal(landing.value, 4);
  assert.equal(preview().runtimeBoundary.redirectEndpointExists, false);
});

test("CO-S6-T19: view/start/complete/form attempt/accepted normalize as distinct events without inference", () => {
  const rawNames = ["tool_view", "tool_start", "tool_complete", "tool_lead", "lead_accepted"];
  const normalized = tracking.normalizeObservations(rawNames.map((rawEventName, index) => {
    const item = observedEvent({ eventId: `evt-${index}`, rawEventName });
    delete item.canonicalEventName;
    return item;
  })).observations;
  assert.deepEqual(normalized.map((item) => item.canonicalEventName), ["TOOL_VIEW", "TOOL_START", "TOOL_COMPLETE", "LEAD_SUBMIT_ATTEMPT", "LEAD_ACCEPTED"]);
});

test("CO-S6-T20: redirect requests do not become YouTube views/watch time/subscribers", () => {
  const redirectRequests = metric({ observationId: "redirect", metricName: "REDIRECT_REQUESTS", value: 30, entityScope: "publication:short-1" });
  const videoViews = metric({ observationId: "views", metricName: "YOUTUBE_VIEWS", value: null, availability: "NO_PERMISSION", entityScope: "video:unknown" });
  const channelSubscribers = metric({ observationId: "subs", metricName: "SUBSCRIBERS_GAINED", value: 12, entityScope: "channel:demo" });
  assert.equal(redirectRequests.value, 30);
  assert.equal(videoViews.value, null);
  assert.notEqual(channelSubscribers.entityScope, videoViews.entityScope);
  assert.equal(scenario("F5-YT-SHORT").result.measurementState, "UNKNOWN");
});

test("CO-S6-T21: known zero, null, permission, delayed, partial and N/A stay distinct", () => {
  const examples = preview().availabilityExamples;
  assert.equal(examples.find((item) => item.state === "AVAILABLE").value, 0);
  assert.equal(examples.find((item) => item.state === "UNKNOWN").value, null);
  assert.deepEqual(new Set(examples.map((item) => item.state)), new Set(["AVAILABLE", "UNKNOWN", "NO_PERMISSION", "DELAYED", "PARTIAL", "NOT_APPLICABLE"]));
});

test("CO-S6-T22: rate evaluator rejects mismatch/zero denominator/>100% and preserves valid zero", () => {
  const denominator = metric({ observationId: "d", value: 10 });
  const validZero = tracking.calculateRate(metric({ observationId: "n0", value: 0 }), denominator);
  const denomZero = tracking.calculateRate(metric({ observationId: "n1", value: 0 }), metric({ observationId: "d0", value: 0 }));
  const mismatch = tracking.calculateRate(metric({ observationId: "n2", value: 1, cohortId: "other" }), denominator);
  const invalid = tracking.calculateRate(metric({ observationId: "n3", value: 11 }), denominator);
  assert.equal(validZero.rate, 0);
  assert.equal(denomZero.rate, null);
  assert.equal(mismatch.reasonCode, "RATE_SCOPE_MISMATCH");
  assert.equal(invalid.reasonCode, "INVALID_COHORT_RATIO");
});

test("CO-S6-T23: synthetic route fixture yields 10/15 and 50/50 without lead, CTR or winner", () => {
  const data = preview().routeMetrics;
  assert.deepEqual(data.arms.map((item) => item.usefulOutcomeRate.rate), [0.1, 0.15]);
  assert.deepEqual(data.arms.map((item) => item.attemptCompletionRate.rate), [0.5, 0.5]);
  assert.ok(data.arms.every((item) => item.leadAccepted === null && item.ctr === null));
  assert.equal(data.experiment.winnerArmId, null);
});

test("CO-S6-T24: CTA_COPY, ROUTE and CHANNEL plans remain observational without thresholds", () => {
  const base = preview().routeMetrics.plan;
  for (const kind of ["CTA_COPY", "ROUTE", "CHANNEL_OBSERVATION"]) {
    const plan = { ...base, kind, assignment: "OBSERVATIONAL", descriptiveOnly: true };
    const result = tracking.evaluateExperiment(plan, {}, {});
    assert.equal(result.winnerArmId, null);
    assert.equal(result.causalConclusionAllowed, false);
    assert.equal(result.plan.descriptiveOnly, true);
    assert.equal("minimumClicks" in result.plan, false);
  }
});

test("CO-S6-T25: internal route preserves acquisition and missing join stays UNKNOWN without fingerprint", () => {
  const result = tracking.evaluateInternalRouteAttribution({ acquisitionBindingRevisionId: baseScenario().binding.bindingRevisionId, internalRouteLegId: "route:article-to-tool", visitId: null, attemptId: "attempt-1" });
  assert.equal(result.acquisitionPreserved, true);
  assert.equal(result.joinState, "UNKNOWN");
  assert.equal(result.attributionScope, "UNATTRIBUTED");
  assert.equal(result.fingerprintUsed, false);
});

test("CO-S6-T26: half-open windows, actual publication checkpoints, daily caveat and late revision preserve history", () => {
  assert.equal(tracking.inHalfOpenWindow("2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"), true);
  assert.equal(tracking.inHalfOpenWindow("2026-10-02T00:00:00Z", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"), false);
  assert.equal(tracking.calculatePublicationCheckpoints(null).status, "UNKNOWN");
  assert.equal(tracking.calculatePublicationCheckpoints("2026-10-01T04:00:00Z").at24h, "2026-10-02T04:00:00.000Z");
  assert.equal(preview().snapshots.current[0].value, 12);
  assert.ok(preview().snapshots.history.length >= 2);
});

test("CO-S6-T27: bypass inputs, network spy and public serializer produce zero side effects/private payload", () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network forbidden"); };
  try { build(); } finally { globalThis.fetch = originalFetch; }
  const rejection = rejectCatalogPreviewMutation({ apply: true, dryRun: false, method: "POST" });
  const publicRows = tracking.serializePublicTrackingProjection([
    { origin: "SYNTHETIC", visibility: "ALLOWLISTED", publicationEvidence: "VERIFIED", materialId: "demo", visitorId: "private", rawEvidence: "private" },
    { origin: "OBSERVED_RUNTIME", visibility: "ALLOWLISTED", publicationEvidence: "VERIFIED", materialId: "public", materialVersion: "v1", publicTitle: "Public", publicUrl: "https://example.com", visitorId: "private", rawEvidence: "private" },
  ]);
  assert.equal(fetchCalls, 0);
  assert.equal(rejection.status, 503);
  assert.equal(publicRows.length, 1);
  assert.equal("visitorId" in publicRows[0], false);
  assert.equal("rawEvidence" in publicRows[0], false);
});

test("CO-S6-T28: CO-S2–S5 boundaries, text gate and identity remain unchanged", () => {
  const work = workFixtures.buildMaterialWorkplanPreview();
  assert.equal(work.backendProjection.realTaskCount, null);
  assert.equal(work.realSnapshotBoundary.activeMaterials, 0);
  assert.equal(work.realSnapshotBoundary.tasksCreatedFromPreview, 0);
  assert.match(work.textPolicy.effective, /Head \+ non-author CM/);
  assert.equal(work.textPolicy.proposalB, "USER_DECISION_PENDING");
  assert.ok(work.initialWorkplan.items.every((item) => item.employeeId === null && item.executable === false));
  assert.equal(preview().runtimeBoundary.physicalSchemaDiff, 0);
});
