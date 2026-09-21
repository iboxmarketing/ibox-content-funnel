import { buildDemoCp070CtaPreview } from "./cta-destination-fixtures";
import { buildMaterialWorkplanPreview } from "./material-workplan-fixtures";
import {
  TRACKING_PREVIEW_CONTRACT_VERSION,
  buildTrackingLink,
  calculatePublicationCheckpoints,
  calculateRate,
  createTrackingBinding,
  dedupeObservations,
  evaluateExperiment,
  reconcileCumulativeSnapshots,
  type AvailabilityState,
  type EventObservation,
  type ExperimentPlan,
  type MeasurementCapability,
  type MetricObservation,
  type TrackingLinkBinding,
  type TrackingNamingPolicy,
} from "./tracking-preview";
import type { DestinationDefinition } from "./cta-destination";

export const CO_S6_DEMO_NAMING_POLICY: TrackingNamingPolicy = {
  policyId: "co-s6.naming-demo",
  version: "v1",
  status: "PROPOSED_LOCAL_ONLY",
  owner: "Digital — haqiqiy tasdiq kutiladi",
  medium: "organic_social",
  platformAliases: {
    "CH-IBOX-TG": "telegram",
    "CH-IBOX-LI": "linkedin",
    "CH-IBOX-YT": "youtube",
    "CH-IBOX-IG": "instagram",
  },
  campaignAlias: "ibox-co-cp070-demo",
  publicCampaignId: "demo-cp070",
  allowedTargets: [
    { destinationId: "DEMO-ARTICLE-CP070-A", hostname: "example.invalid", pathPrefix: "/guide", allowedExistingParams: ["lang", "section"] },
    { destinationId: "TL-024", hostname: "fixture.invalid", pathPrefix: "/tl-024", allowedExistingParams: [] },
  ],
};

const articleDestination: DestinationDefinition = {
  destinationId: "DEMO-ARTICLE-CP070-A",
  definitionVersion: "tracking-demo.v1",
  type: "ARTICLE",
  targetReference: "demo:cp070:a:article",
  promisedOutcomeUz: "Mijozlar bazasini tekshirish tartibini o‘qish",
  language: "UZ",
  audience: "Synthetic preview audience",
  configuredUrl: "https://example.invalid/guide?lang=uz#checklist",
  lifecycleStatus: "DRAFT",
  provenance: "CO-S6 SYNTHETIC fixture; real IBOX URL emas",
};

function capability(input: Partial<MeasurementCapability> & Pick<MeasurementCapability, "platform" | "accountId" | "formatCode" | "placement" | "action" | "metric">): MeasurementCapability {
  return {
    capabilityId: `cap:${input.platform}:${input.accountId}:${input.formatCode}:${input.placement}:${input.action}:${input.metric}`,
    clickable: null,
    nativeActionSupported: null,
    permission: "UNKNOWN",
    measurement: "UNKNOWN",
    attributionScope: "PUBLICATION_OCCURRENCE",
    checkedAt: null,
    evidenceOrigin: "UNKNOWN",
    ...input,
  };
}

const telegramCapability = capability({ platform: "Telegram", accountId: "DEMO-ACCOUNT-TG", formatCode: "SHORT_VIDEO", placement: "POST_CAPTION", action: "READ_ARTICLE", metric: "PLATFORM_LINK_CLICK", clickable: true, evidenceOrigin: "SYNTHETIC_FIXTURE" });
const linkedinCapability = capability({ platform: "LinkedIn", accountId: "DEMO-ACCOUNT-LI", formatCode: "SHORT_VIDEO", placement: "POST_CAPTION", action: "READ_ARTICLE", metric: "PLATFORM_LINK_CLICK", clickable: true, evidenceOrigin: "SYNTHETIC_FIXTURE" });
const youtubeShortsDescription = capability({ platform: "YouTube", accountId: "DEMO-ACCOUNT-YT", formatCode: "SHORT_VIDEO", placement: "SHORTS_DESCRIPTION", action: "READ_ARTICLE", metric: "PLATFORM_LINK_CLICK", clickable: false, evidenceOrigin: "SYNTHETIC_FIXTURE" });
const youtubeLongDescription = capability({ platform: "YouTube", accountId: "DEMO-ACCOUNT-YT", formatCode: "LONG_VIDEO", placement: "LONG_DESCRIPTION", action: "READ_ARTICLE", metric: "PLATFORM_LINK_CLICK", clickable: null, evidenceOrigin: "UNKNOWN" });
const nativeSaveCapability = capability({ platform: "Instagram", accountId: "DEMO-ACCOUNT-IG", formatCode: "CAROUSEL", placement: "POST", action: "SAVE", metric: "NATIVE_SAVE", nativeActionSupported: true, evidenceOrigin: "SYNTHETIC_FIXTURE", attributionScope: "PUBLICATION_OCCURRENCE" });
const sharedBioCapability = capability({ platform: "Instagram", accountId: "DEMO-ACCOUNT-IG", formatCode: "CAROUSEL", placement: "SHARED_BIO", action: "USE_TOOL", metric: "ENTRY_VISIT", clickable: true, evidenceOrigin: "SYNTHETIC_FIXTURE", attributionScope: "CHANNEL_OR_SHARED_PLACEMENT" });

function binding(input: { channelId: string; accountId: string; placement: string; publicationIntentId: string; occurrenceId?: string; formatCode?: string; destinationId?: string | null; destinationDefinitionVersion?: string | null; ctaMode?: "RESOURCE" | "NATIVE"; nativeAction?: string | null; nativeTarget?: string | null; ctaVariantId?: string; ctaVariantVersion?: string; routeLegId?: string | null }): TrackingLinkBinding {
  return createTrackingBinding({
    publicationIntentId: input.publicationIntentId,
    publicationIntentVersion: "v1",
    occurrenceId: input.occurrenceId ?? "occ-1",
    materialId: "demo:cp070:a:base-short",
    materialVersion: "demo.v1",
    ctaVariantId: input.ctaVariantId ?? "demo:cta:read-article",
    ctaVariantVersion: input.ctaVariantVersion ?? "v1",
    ctaMode: input.ctaMode ?? "RESOURCE",
    nativeAction: input.nativeAction ?? null,
    nativeTarget: input.nativeTarget ?? null,
    destinationId: input.destinationId === undefined ? articleDestination.destinationId : input.destinationId,
    destinationDefinitionVersion: input.destinationDefinitionVersion === undefined ? articleDestination.definitionVersion : input.destinationDefinitionVersion,
    channelId: input.channelId,
    accountId: input.accountId,
    formatCode: input.formatCode ?? "SHORT_VIDEO",
    placement: input.placement,
    packageRef: "DEMO-PKG-CP070",
    angleRef: "DEMO-ANG-CP070-A",
    routeLegId: input.routeLegId ?? "route:external-to-article",
    experimentId: "DEMO-EXP-CP070-CHANNEL",
    experimentArmId: input.channelId,
    experimentVersion: "v1",
    namingPolicyId: CO_S6_DEMO_NAMING_POLICY.policyId,
    namingPolicyVersion: CO_S6_DEMO_NAMING_POLICY.version,
    origin: "SYNTHETIC",
  });
}

function metric(input: Partial<MetricObservation> & Pick<MetricObservation, "observationId" | "metricName" | "definitionId" | "value" | "unit" | "entityScope" | "cohortId" | "rateContractId" | "sourceScopeKey">): MetricObservation {
  return {
    windowStart: "2026-10-01T00:00:00.000+05:00",
    windowEnd: "2026-10-08T00:00:00.000+05:00",
    timezone: "Asia/Tashkent",
    source: "CO-S6 synthetic route fixture",
    asOf: "2026-10-08T01:00:00.000+05:00",
    granularity: "EVENT",
    availability: "AVAILABLE",
    completenessReason: null,
    revision: 1,
    origin: "SYNTHETIC",
    ...input,
  };
}

function event(input: Partial<EventObservation> & Pick<EventObservation, "eventId" | "rawEventName" | "canonicalEventName" | "occurredAt" | "attemptId">): EventObservation {
  return {
    source: "synthetic-owned-tool",
    stream: "demo-stream",
    origin: "SYNTHETIC",
    environment: "TEST",
    receivedAt: input.occurredAt,
    publicationIntentId: "demo:intent:tool",
    visitId: input.attemptId ? `visit:${input.attemptId}` : null,
    toolId: "TL-024",
    toolVersion: "demo.v1",
    completionMilestone: input.canonicalEventName === "TOOL_COMPLETE" ? "RESULT_RENDERED" : null,
    submissionId: null,
    trafficClass: "KNOWN_TEST",
    value: null,
    ...input,
  };
}

export function buildTrackingPreview() {
  const workplan = buildMaterialWorkplanPreview();
  const ctaPreview = buildDemoCp070CtaPreview();
  const telegramBinding = binding({ channelId: "CH-IBOX-TG", accountId: "DEMO-ACCOUNT-TG", placement: "POST_CAPTION", publicationIntentId: "demo:intent:cp070:short:tg" });
  const linkedinBinding = binding({ channelId: "CH-IBOX-LI", accountId: "DEMO-ACCOUNT-LI", placement: "POST_CAPTION", publicationIntentId: "demo:intent:cp070:short:li" });
  const youtubeShortBinding = binding({ channelId: "CH-IBOX-YT", accountId: "DEMO-ACCOUNT-YT", placement: "SHORTS_DESCRIPTION", publicationIntentId: "demo:intent:cp070:short:yt" });
  const youtubeLongBinding = binding({ channelId: "CH-IBOX-YT", accountId: "DEMO-ACCOUNT-YT", placement: "LONG_DESCRIPTION", publicationIntentId: "demo:intent:cp070:long:yt", formatCode: "LONG_VIDEO" });
  const nativeBinding = binding({ channelId: "CH-IBOX-IG", accountId: "DEMO-ACCOUNT-IG", placement: "POST", publicationIntentId: "demo:intent:cp070:carousel:ig", formatCode: "CAROUSEL", ctaMode: "NATIVE", nativeAction: "SAVE", nativeTarget: "CURRENT_PUBLICATION", destinationId: null, destinationDefinitionVersion: null, ctaVariantId: "demo:cta:save" });
  const sharedBioBinding = binding({ channelId: "CH-IBOX-IG", accountId: "DEMO-ACCOUNT-IG", placement: "SHARED_BIO", publicationIntentId: "demo:intent:cp070:bio", formatCode: "CAROUSEL", routeLegId: "route:shared-bio-to-tool" });

  const telegram = buildTrackingLink({ binding: telegramBinding, policy: CO_S6_DEMO_NAMING_POLICY, destination: articleDestination, capability: telegramCapability, ctaDestinationGate: "PASS" });
  const linkedin = buildTrackingLink({ binding: linkedinBinding, policy: CO_S6_DEMO_NAMING_POLICY, destination: articleDestination, capability: linkedinCapability, ctaDestinationGate: "PASS" });
  const youtubeShort = buildTrackingLink({ binding: youtubeShortBinding, policy: CO_S6_DEMO_NAMING_POLICY, destination: articleDestination, capability: youtubeShortsDescription, ctaDestinationGate: "PASS" });
  const youtubeLong = buildTrackingLink({ binding: youtubeLongBinding, policy: CO_S6_DEMO_NAMING_POLICY, destination: articleDestination, capability: youtubeLongDescription, ctaDestinationGate: "PASS" });
  const nativeSave = buildTrackingLink({ binding: nativeBinding, policy: CO_S6_DEMO_NAMING_POLICY, destination: null, capability: nativeSaveCapability, ctaDestinationGate: "PASS" });
  const sharedBio = buildTrackingLink({ binding: sharedBioBinding, policy: CO_S6_DEMO_NAMING_POLICY, destination: articleDestination, capability: sharedBioCapability, ctaDestinationGate: "UNKNOWN" });

  const toolMaterial = ctaPreview.materials.find((item) => item.materialId === "demo:cp070:a:tool-post");
  const toolBinding = binding({ channelId: "CH-IBOX-TG", accountId: "DEMO-ACCOUNT-TG", placement: "POST_CAPTION", publicationIntentId: "demo:intent:cp070:tool:tg", destinationId: "TL-024", destinationDefinitionVersion: "sheet-observed-v1", ctaVariantId: toolMaterial?.variant.ctaVariantId ?? "demo:cta:use-tool" });
  const toolResult = buildTrackingLink({ binding: toolBinding, policy: CO_S6_DEMO_NAMING_POLICY, destination: toolMaterial?.destination ?? null, capability: telegramCapability, ctaDestinationGate: toolMaterial?.evaluation.ctaDestinationGate ?? "BLOCKED" });

  const routeAVisits = metric({ observationId: "m-ra-visits", metricName: "ELIGIBLE_ENTRY_VISITS", definitionId: "entry-visit.v1", value: 200, unit: "ENTRY_VISITS", entityScope: "route:R-A", cohortId: "cp070-route-demo", rateContractId: "route-useful-outcome.v1", sourceScopeKey: "synthetic-route-source" });
  const routeAOutcomes = metric({ observationId: "m-ra-complete-visits", metricName: "COMPLETED_ENTRY_VISITS", definitionId: "entry-visit-with-tool-complete.v1", value: 20, unit: "ENTRY_VISITS_WITH_OUTCOME", entityScope: "route:R-A", cohortId: "cp070-route-demo", rateContractId: "route-useful-outcome.v1", sourceScopeKey: "synthetic-route-source" });
  const routeBVisits = metric({ observationId: "m-rb-visits", metricName: "ELIGIBLE_ENTRY_VISITS", definitionId: "entry-visit.v1", value: 120, unit: "ENTRY_VISITS", entityScope: "route:R-B", cohortId: "cp070-route-demo", rateContractId: "route-useful-outcome.v1", sourceScopeKey: "synthetic-route-source" });
  const routeBOutcomes = metric({ observationId: "m-rb-complete-visits", metricName: "COMPLETED_ENTRY_VISITS", definitionId: "entry-visit-with-tool-complete.v1", value: 18, unit: "ENTRY_VISITS_WITH_OUTCOME", entityScope: "route:R-B", cohortId: "cp070-route-demo", rateContractId: "route-useful-outcome.v1", sourceScopeKey: "synthetic-route-source" });
  const routeAAttempts = metric({ observationId: "m-ra-attempts", metricName: "STARTED_ATTEMPTS", definitionId: "tool-start.v1", value: 40, unit: "ATTEMPTS", entityScope: "tool:TL-024:R-A", cohortId: "cp070-attempt-demo-a", rateContractId: "attempt-completion.v1", sourceScopeKey: "synthetic-attempt-source" });
  const routeACompletes = metric({ observationId: "m-ra-completes", metricName: "COMPLETED_ATTEMPTS", definitionId: "tool-complete.v1", value: 20, unit: "COMPLETED_ATTEMPTS", entityScope: "tool:TL-024:R-A", cohortId: "cp070-attempt-demo-a", rateContractId: "attempt-completion.v1", sourceScopeKey: "synthetic-attempt-source" });
  const routeBAttempts = metric({ observationId: "m-rb-attempts", metricName: "STARTED_ATTEMPTS", definitionId: "tool-start.v1", value: 36, unit: "ATTEMPTS", entityScope: "tool:TL-024:R-B", cohortId: "cp070-attempt-demo-b", rateContractId: "attempt-completion.v1", sourceScopeKey: "synthetic-attempt-source" });
  const routeBCompletes = metric({ observationId: "m-rb-completes", metricName: "COMPLETED_ATTEMPTS", definitionId: "tool-complete.v1", value: 18, unit: "COMPLETED_ATTEMPTS", entityScope: "tool:TL-024:R-B", cohortId: "cp070-attempt-demo-b", rateContractId: "attempt-completion.v1", sourceScopeKey: "synthetic-attempt-source" });
  const routeARate = calculateRate(routeAOutcomes, routeAVisits);
  const routeBRate = calculateRate(routeBOutcomes, routeBVisits);
  const routeACompletion = calculateRate(routeACompletes, routeAAttempts);
  const routeBCompletion = calculateRate(routeBCompletes, routeBAttempts);
  const experimentPlan: ExperimentPlan = {
    experimentId: "DEMO-EXP-CP070-ROUTE",
    version: "v1",
    kind: "ROUTE",
    objectiveUz: "Maqola orqali va to‘g‘ridan-to‘g‘ri tool yo‘lining foydali natija ulushini kuzatish",
    assignment: "OBSERVATIONAL",
    descriptiveOnly: true,
    arms: [
      { armId: "R-A", labelUz: "Maqola → instrument", bindingRevisionIds: [telegramBinding.bindingRevisionId] },
      { armId: "R-B", labelUz: "To‘g‘ridan-to‘g‘ri instrument", bindingRevisionIds: [toolBinding.bindingRevisionId] },
    ],
    windowStart: routeAVisits.windowStart,
    windowEnd: routeAVisits.windowEnd,
    timezone: routeAVisits.timezone,
    origin: "SYNTHETIC",
  };
  const experiment = evaluateExperiment(experimentPlan, { "R-A": routeARate, "R-B": routeBRate }, { "R-A": 20, "R-B": 18 });

  const dedupeInput: EventObservation[] = [
    event({ eventId: "evt-start-a", rawEventName: "tool_start", canonicalEventName: "TOOL_START", occurredAt: "2026-10-02T09:00:00.000Z", attemptId: "attempt-a" }),
    event({ eventId: "evt-complete-a", rawEventName: "tool_complete", canonicalEventName: "TOOL_COMPLETE", occurredAt: "2026-10-02T09:03:00.000Z", attemptId: "attempt-a" }),
    event({ eventId: "evt-complete-a", rawEventName: "tool_complete", canonicalEventName: "TOOL_COMPLETE", occurredAt: "2026-10-02T09:03:00.000Z", receivedAt: "2026-10-02T09:03:01.000Z", attemptId: "attempt-a" }),
    event({ eventId: "evt-complete-a", rawEventName: "tool_complete", canonicalEventName: "TOOL_COMPLETE", occurredAt: "2026-10-02T09:03:00.000Z", receivedAt: "2026-10-02T09:03:02.000Z", attemptId: "attempt-a" }),
    event({ eventId: "evt-complete-a-render", rawEventName: "tool_complete", canonicalEventName: "TOOL_COMPLETE", occurredAt: "2026-10-02T09:03:00.000Z", attemptId: "attempt-a" }),
    event({ eventId: "evt-start-b", rawEventName: "tool_start", canonicalEventName: "TOOL_START", occurredAt: "2026-10-02T10:00:00.000Z", attemptId: "attempt-b" }),
    event({ eventId: "evt-complete-b", rawEventName: "tool_complete", canonicalEventName: "TOOL_COMPLETE", occurredAt: "2026-10-02T10:02:00.000Z", attemptId: "attempt-b" }),
  ];
  const dedupe = dedupeObservations(dedupeInput);
  const snapshots = reconcileCumulativeSnapshots([
    { snapshotId: "snap-1", provider: "demo-platform", sourceMode: "API", accountId: "demo-account", entityId: "demo-post", metricName: "LINK_CLICKS", definitionId: "provider-click.v1", windowStart: routeAVisits.windowStart, windowEnd: routeAVisits.windowEnd, value: 10, revision: 1, asOf: "2026-10-08T00:00:00.000Z" },
    { snapshotId: "snap-1-retry", provider: "demo-platform", sourceMode: "API", accountId: "demo-account", entityId: "demo-post", metricName: "LINK_CLICKS", definitionId: "provider-click.v1", windowStart: routeAVisits.windowStart, windowEnd: routeAVisits.windowEnd, value: 10, revision: 1, asOf: "2026-10-08T00:00:00.000Z" },
    { snapshotId: "snap-2", provider: "demo-platform", sourceMode: "API", accountId: "demo-account", entityId: "demo-post", metricName: "LINK_CLICKS", definitionId: "provider-click.v1", windowStart: routeAVisits.windowStart, windowEnd: routeAVisits.windowEnd, value: 12, revision: 2, asOf: "2026-10-08T02:00:00.000Z" },
  ]);

  const availabilityExamples: Array<{ labelUz: string; state: AvailabilityState; value: number | null; reasonUz: string }> = [
    { labelUz: "Kuzatilgan haqiqiy 0", state: "AVAILABLE", value: 0, reasonUz: "Mos manba va davrda qiymat 0." },
    { labelUz: "Kliklar", state: "UNKNOWN", value: null, reasonUz: "Platform click manbasi ulanmagan." },
    { labelUz: "YouTube ko‘rishlar", state: "NO_PERMISSION", value: null, reasonUz: "Actual account/API ruxsati olinmagan." },
    { labelUz: "Kechikkan report", state: "DELAYED", value: null, reasonUz: "Provider davri yopilmagan." },
    { labelUz: "Qisman qamrov", state: "PARTIAL", value: 7, reasonUz: "Faqat bir source revision mavjud." },
    { labelUz: "Native URL", state: "NOT_APPLICABLE", value: null, reasonUz: "SAVE uchun tashqi URL kerak emas." },
  ];

  return {
    contractVersion: TRACKING_PREVIEW_CONTRACT_VERSION,
    fixtureId: "DEMO_CP070_TRACKING_PREVIEW" as const,
    origin: "SYNTHETIC" as const,
    safetyMode: "CO_S6_LOCAL_PREVIEW_ONLY" as const,
    executionAllowed: false as const,
    policy: CO_S6_DEMO_NAMING_POLICY,
    materialBoundary: {
      materialId: telegramBinding.materialId,
      materialVersion: telegramBinding.materialVersion,
      publicationIntentCount: 2,
      materialCount: 1,
      researchCountBefore: 1,
      researchCountAfter: 1,
      shootCountBefore: 1,
      shootCountAfter: 1,
      mainEditCountBefore: 1,
      mainEditCountAfter: 1,
      existingWorkplanProjectionId: workplan.initialWorkplan.projectionId,
    },
    destinations: { article: articleDestination, tool: toolMaterial?.destination ?? null },
    links: [
      { scenarioId: "F1-TG", labelUz: "Telegram · post caption", binding: telegramBinding, capability: telegramCapability, result: telegram },
      { scenarioId: "F1-LI", labelUz: "LinkedIn · post caption", binding: linkedinBinding, capability: linkedinCapability, result: linkedin },
      { scenarioId: "F5-YT-SHORT", labelUz: "YouTube Shorts · description", binding: youtubeShortBinding, capability: youtubeShortsDescription, result: youtubeShort },
      { scenarioId: "F5-YT-LONG", labelUz: "YouTube long · description", binding: youtubeLongBinding, capability: youtubeLongDescription, result: youtubeLong },
      { scenarioId: "F2-NATIVE", labelUz: "Instagram · native SAVE", binding: nativeBinding, capability: nativeSaveCapability, result: nativeSave },
      { scenarioId: "F2-TOOL-BLOCK", labelUz: "Telegram · TL-024 tool", binding: toolBinding, capability: telegramCapability, result: toolResult },
      { scenarioId: "F5-SHARED-BIO", labelUz: "Instagram · shared bio", binding: sharedBioBinding, capability: sharedBioCapability, result: sharedBio },
    ],
    routeMetrics: {
      plan: experimentPlan,
      experiment,
      arms: [
        { armId: "R-A", labelUz: "Maqola → instrument", visits: 200, attempts: 40, completes: 20, usefulOutcomeRate: routeARate, attemptCompletionRate: routeACompletion, ctr: null, leadAccepted: null },
        { armId: "R-B", labelUz: "To‘g‘ridan-to‘g‘ri instrument", visits: 120, attempts: 36, completes: 18, usefulOutcomeRate: routeBRate, attemptCompletionRate: routeBCompletion, ctr: null, leadAccepted: null },
      ],
    },
    eventDedupe: { rawCount: dedupeInput.length, ...dedupe, uniqueCompletionCount: dedupe.observations.filter((item) => item.canonicalEventName === "TOOL_COMPLETE").length },
    snapshots,
    availabilityExamples,
    checkpoints: {
      available: calculatePublicationCheckpoints("2026-10-01T09:00:00.000+05:00"),
      unknown: calculatePublicationCheckpoints(null),
    },
    runtimeBoundary: {
      analyticsConnected: false,
      collectorConnected: false,
      redirectEndpointExists: false,
      realTrafficObserved: false,
      realPublicationCount: null,
      realEventCount: null,
      physicalSchemaDiff: 0,
      writerCalls: 0,
      externalNetworkCalls: 0,
      llmCalls: 0,
    },
  };
}

export type TrackingPreviewFixture = ReturnType<typeof buildTrackingPreview>;
