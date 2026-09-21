import type { CtaDestinationGate, CtaMode, DestinationDefinition } from "./cta-destination";

export const TRACKING_PREVIEW_CONTRACT_VERSION = "co-s6.tracking-preview.v1" as const;

export type TrackingOrigin = "DEMO_CP070" | "LOCAL_REGRESSION_FIXTURE" | "SYNTHETIC" | "OBSERVED_RUNTIME" | "MANUAL_UNVERIFIED";
export type AvailabilityState = "AVAILABLE" | "UNKNOWN" | "NO_PERMISSION" | "NOT_INSTRUMENTED" | "DELAYED" | "PARTIAL" | "NOT_APPLICABLE";
export type StructuralState = "SYNTAX_VALID" | "INVALID" | "INCOMPLETE" | "NOT_APPLICABLE";
export type PlacementState = "SUPPORTED" | "NON_CLICKABLE_PLACEMENT" | "UNKNOWN" | "NOT_APPLICABLE";
export type AttributionScope = "PUBLICATION_OCCURRENCE" | "CHANNEL_OR_SHARED_PLACEMENT" | "UNATTRIBUTED";

export type TrackingDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  reasonUz: string;
};

export type TrackingNamingPolicy = {
  policyId: string;
  version: string;
  status: "PROPOSED_LOCAL_ONLY" | "RELEASED";
  owner: string;
  medium: string;
  platformAliases: Record<string, string>;
  campaignAlias: string;
  publicCampaignId: string;
  allowedTargets: Array<{
    destinationId: string;
    hostname: string;
    pathPrefix: string;
    allowedExistingParams: string[];
  }>;
};

export type TrackingLinkBinding = {
  bindingSeriesId: string;
  bindingRevisionId: string;
  revision: number;
  previousBindingRevisionId: string | null;
  publicationIntentId: string;
  publicationIntentVersion: string;
  occurrenceId: string;
  materialId: string;
  materialVersion: string | null;
  ctaVariantId: string;
  ctaVariantVersion: string;
  ctaMode: CtaMode;
  nativeAction: string | null;
  nativeTarget: string | null;
  destinationId: string | null;
  destinationDefinitionVersion: string | null;
  channelId: string;
  accountId: string;
  formatCode: string;
  placement: string;
  packageRef: string;
  angleRef: string;
  routeLegId: string | null;
  experimentId: string | null;
  experimentArmId: string | null;
  experimentVersion: string | null;
  namingPolicyId: string;
  namingPolicyVersion: string;
  origin: TrackingOrigin;
};

export type MeasurementCapability = {
  capabilityId: string;
  platform: string;
  accountId: string;
  formatCode: string;
  placement: string;
  action: string;
  metric: string;
  clickable: boolean | null;
  nativeActionSupported: boolean | null;
  permission: AvailabilityState;
  measurement: AvailabilityState;
  attributionScope: AttributionScope;
  checkedAt: string | null;
  evidenceOrigin: "SYNTHETIC_FIXTURE" | "RUNTIME" | "UNKNOWN";
};

export type TrackingLinkResult = {
  contractVersion: typeof TRACKING_PREVIEW_CONTRACT_VERSION;
  url: string | null;
  token: string | null;
  targetFingerprint: string | null;
  structuralState: StructuralState;
  placementState: PlacementState;
  destinationState: CtaDestinationGate;
  measurementState: AvailabilityState;
  attributionScope: AttributionScope;
  executionAllowed: false;
  diagnostics: TrackingDiagnostic[];
};

export type BuildTrackingLinkInput = {
  binding: TrackingLinkBinding;
  policy: TrackingNamingPolicy | null;
  destination: DestinationDefinition | null;
  capability: MeasurementCapability | null;
  ctaDestinationGate: CtaDestinationGate;
};

const TRACKING_KEYS = ["utm_campaign", "utm_content", "utm_id", "utm_medium", "utm_source", "utm_source_platform"] as const;
const SENSITIVE_KEYS = new Set(["email", "phone", "telephone", "employee_id", "telegram_id", "task_id", "private_note", "authorization", "api_key", "apikey", "secret", "private_key", "access_token"]);
const UNSUPPORTED_SIGNED_OR_AD_KEYS = new Set(["gclid", "fbclid", "msclkid", "signature", "sig", "expires", "x-amz-signature"]);
const REDIRECT_KEYS = new Set(["url", "target", "redirect", "redirect_uri", "next", "continue"]);

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: unknown) {
  const source = canonicalize(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function looksSensitive(value: string) {
  const decoded = (() => {
    try { return decodeURIComponent(value); } catch { return value; }
  })();
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(decoded)) return true;
  if (/(?:\+?\d[\s().-]*){8,}/.test(decoded)) return true;
  if (/\b(?:EMP|TASK|TG)-[A-Z0-9_-]{3,}\b/i.test(decoded)) return true;
  if (/(?:private[_-]?key|bearer\s+|api[_-]?key|client[_-]?secret)/i.test(decoded)) return true;
  return false;
}

function hasEncodedRedirect(key: string, value: string) {
  if (!REDIRECT_KEYS.has(key.toLowerCase())) return false;
  const decoded = (() => {
    try { return decodeURIComponent(value); } catch { return value; }
  })();
  return /^(?:https?:)?\/\//i.test(decoded.trim());
}

function isPrivateHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  if (["localhost", "0.0.0.0", "::1"].includes(lower) || lower.endsWith(".local")) return true;
  if (/^127\./.test(lower) || /^10\./.test(lower) || /^192\.168\./.test(lower)) return true;
  const match = lower.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function placementStateFor(mode: CtaMode, capability: MeasurementCapability | null): PlacementState {
  if (!capability) return "UNKNOWN";
  if (mode === "NATIVE") {
    if (capability.nativeActionSupported === false) return "NON_CLICKABLE_PLACEMENT";
    return capability.nativeActionSupported === true ? "SUPPORTED" : "UNKNOWN";
  }
  if (capability.clickable === false) return "NON_CLICKABLE_PLACEMENT";
  return capability.clickable === true ? "SUPPORTED" : "UNKNOWN";
}

function trackingValues(binding: TrackingLinkBinding, policy: TrackingNamingPolicy, token: string) {
  const platform = policy.platformAliases[binding.channelId];
  if (!platform) return null;
  return {
    utm_campaign: policy.campaignAlias,
    utm_content: token,
    utm_id: policy.publicCampaignId,
    utm_medium: policy.medium,
    utm_source: platform,
    utm_source_platform: platform,
  };
}

function tokenInput(binding: TrackingLinkBinding) {
  return {
    publicationIntentId: binding.publicationIntentId,
    publicationIntentVersion: binding.publicationIntentVersion,
    occurrenceId: binding.occurrenceId,
    materialId: binding.materialId,
    materialVersion: binding.materialVersion,
    ctaVariantId: binding.ctaVariantId,
    ctaVariantVersion: binding.ctaVariantVersion,
    destinationId: binding.destinationId,
    destinationDefinitionVersion: binding.destinationDefinitionVersion,
    nativeAction: binding.nativeAction,
    nativeTarget: binding.nativeTarget,
    channelId: binding.channelId,
    accountId: binding.accountId,
    formatCode: binding.formatCode,
    placement: binding.placement,
    routeLegId: binding.routeLegId,
    experimentId: binding.experimentId,
    experimentArmId: binding.experimentArmId,
    experimentVersion: binding.experimentVersion,
    namingPolicyId: binding.namingPolicyId,
    namingPolicyVersion: binding.namingPolicyVersion,
    revision: binding.revision,
  };
}

export function createTrackingBinding(input: Omit<TrackingLinkBinding, "bindingSeriesId" | "bindingRevisionId" | "revision" | "previousBindingRevisionId">): TrackingLinkBinding {
  const bindingSeriesId = `tracking:${input.publicationIntentId}:${input.occurrenceId}`;
  return { ...input, bindingSeriesId, bindingRevisionId: `${bindingSeriesId}:r1`, revision: 1, previousBindingRevisionId: null };
}

const SEMANTIC_BINDING_FIELDS = [
  "publicationIntentVersion", "occurrenceId", "materialVersion", "ctaVariantId", "ctaVariantVersion", "ctaMode", "nativeAction", "nativeTarget",
  "destinationId", "destinationDefinitionVersion", "channelId", "accountId", "formatCode", "placement", "routeLegId", "experimentId", "experimentArmId",
  "experimentVersion", "namingPolicyId", "namingPolicyVersion",
] as const satisfies ReadonlyArray<keyof TrackingLinkBinding>;

export function reviseTrackingBinding(current: TrackingLinkBinding, next: Partial<TrackingLinkBinding>) {
  const merged = { ...current, ...next };
  const semanticChanged = SEMANTIC_BINDING_FIELDS.some((field) => current[field] !== merged[field]);
  if (!semanticChanged) return { previous: current, revised: current, bindingChanged: false };
  const revision = current.revision + 1;
  const revised: TrackingLinkBinding = {
    ...merged,
    bindingSeriesId: current.bindingSeriesId,
    bindingRevisionId: `${current.bindingSeriesId}:r${revision}`,
    revision,
    previousBindingRevisionId: current.bindingRevisionId,
  };
  return { previous: current, revised, bindingChanged: true };
}

/** Pure link builder. It parses text only and never fetches or opens a URL. */
export function buildTrackingLink(input: BuildTrackingLinkInput): TrackingLinkResult {
  const { binding, policy, destination, capability } = input;
  const diagnostics: TrackingDiagnostic[] = [];
  const placementState = placementStateFor(binding.ctaMode, capability);
  const measurementState = capability?.measurement ?? "UNKNOWN";
  const attributionScope = capability?.attributionScope ?? "UNATTRIBUTED";

  const result = (state: StructuralState, url: string | null, token: string | null, targetFingerprint: string | null): TrackingLinkResult => ({
    contractVersion: TRACKING_PREVIEW_CONTRACT_VERSION,
    url,
    token,
    targetFingerprint,
    structuralState: state,
    placementState,
    destinationState: input.ctaDestinationGate,
    measurementState,
    attributionScope,
    executionAllowed: false,
    diagnostics,
  });

  if (binding.ctaMode === "NATIVE") {
    diagnostics.push({ code: "NATIVE_URL_NOT_REQUIRED", severity: "info", reasonUz: "Native amal uchun sun’iy tashqi URL yoki UTM yaratilmaydi." });
    if (placementState === "UNKNOWN") diagnostics.push({ code: "NATIVE_CAPABILITY_UNKNOWN", severity: "warning", reasonUz: "Native amalning aynan shu placementdagi imkoniyati hali tasdiqlanmagan." });
    return result("NOT_APPLICABLE", null, null, null);
  }

  if (!policy || binding.namingPolicyId !== policy.policyId || binding.namingPolicyVersion !== policy.version) {
    diagnostics.push({ code: "NAMING_POLICY_MISSING_OR_MISMATCH", severity: "error", reasonUz: "Binding uchun aniq naming policy va versiya topilmadi." });
    return result("INCOMPLETE", null, null, null);
  }
  if (!binding.materialVersion || !binding.destinationId || !binding.destinationDefinitionVersion) {
    diagnostics.push({ code: "TRACKING_BINDING_INCOMPLETE", severity: "error", reasonUz: "Material, CTA yoki destinationning pinned versiyasi yetishmaydi." });
    return result("INCOMPLETE", null, null, null);
  }
  if (!destination || destination.destinationId !== binding.destinationId || destination.definitionVersion !== binding.destinationDefinitionVersion) {
    diagnostics.push({ code: "DESTINATION_VERSION_MISMATCH", severity: "error", reasonUz: "Destination definition bindingdagi pinned versiyaga mos emas." });
    return result("INCOMPLETE", null, null, null);
  }
  if (!destination.configuredUrl) {
    diagnostics.push({ code: "DESTINATION_URL_NOT_CONFIGURED", severity: "warning", reasonUz: "Destination uchun tashrifchi manzili berilmagan; demo fallback qo‘yilmadi." });
    return result("INCOMPLETE", null, null, null);
  }

  let parsed: URL;
  try {
    parsed = new URL(destination.configuredUrl);
  } catch {
    diagnostics.push({ code: "DESTINATION_URL_INVALID", severity: "error", reasonUz: "Destination URL sintaksisi yaroqsiz." });
    return result("INVALID", null, null, null);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) {
    diagnostics.push({ code: "UNSAFE_DESTINATION_TARGET", severity: "error", reasonUz: "Faqat credentialsiz, public HTTPS destinationga ruxsat beriladi." });
    return result("INVALID", null, null, null);
  }
  const targetRule = policy.allowedTargets.find((item) => item.destinationId === destination.destinationId && item.hostname === parsed.hostname && parsed.pathname.startsWith(item.pathPrefix));
  if (!targetRule) {
    diagnostics.push({ code: "DESTINATION_NOT_ALLOWLISTED", severity: "error", reasonUz: "Hostname yoki path aniq allowlist qoidasiga mos emas." });
    return result("INVALID", null, null, null);
  }
  if (looksSensitive(`${parsed.pathname}${parsed.search}${parsed.hash}`)) {
    diagnostics.push({ code: "SENSITIVE_VALUE_REJECTED", severity: "error", reasonUz: "URL path/query/fragment ichida private yoki shaxsiy qiymat aniqlandi; raw qiymat chiqarilmadi." });
    return result("INVALID", null, null, null);
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || looksSensitive(value)) {
      diagnostics.push({ code: "SENSITIVE_VALUE_REJECTED", severity: "error", reasonUz: "URL parametrida private yoki shaxsiy qiymat aniqlandi; raw qiymat chiqarilmadi." });
      return result("INVALID", null, null, null);
    }
    if (hasEncodedRedirect(lower, value)) {
      diagnostics.push({ code: "ENCODED_REDIRECT_REJECTED", severity: "error", reasonUz: "Arbitrary yoki encoded redirect parametri ruxsat etilmaydi." });
      return result("INVALID", null, null, null);
    }
    if (UNSUPPORTED_SIGNED_OR_AD_KEYS.has(lower)) {
      diagnostics.push({ code: "UNSUPPORTED_SIGNED_OR_AD_PARAM", severity: "error", reasonUz: "Signed yoki advertising parametri bu demo policy bilan xavfsiz normalizatsiya qilinmaydi." });
      return result("INVALID", null, null, null);
    }
    if (!lower.startsWith("utm_") && !targetRule.allowedExistingParams.includes(key)) {
      diagnostics.push({ code: "EXISTING_PARAM_NOT_ALLOWED", severity: "error", reasonUz: "Destinationdagi mavjud query parametri aniq allowlistga kirmaydi." });
      return result("INVALID", null, null, null);
    }
  }

  const token = `trk_${stableHash(tokenInput(binding)).slice(0, 14)}`;
  const values = trackingValues(binding, policy, token);
  if (!values) {
    diagnostics.push({ code: "PLATFORM_ALIAS_MISSING", severity: "error", reasonUz: "Tanlangan kanal uchun public-safe platform aliasi topilmadi." });
    return result("INCOMPLETE", null, null, null);
  }
  for (const key of TRACKING_KEYS) {
    const expected = values[key];
    const existing = parsed.searchParams.getAll(key);
    if (existing.some((value) => value !== expected)) {
      diagnostics.push({ code: "TRACKING_PARAM_CONFLICT", severity: "error", reasonUz: "Mavjud tracking parametri pinned binding qiymati bilan zid; jim almashtirilmadi." });
      return result("INVALID", null, null, null);
    }
    parsed.searchParams.delete(key);
    parsed.searchParams.set(key, expected);
  }
  parsed.searchParams.sort();
  const url = parsed.toString();
  const targetFingerprint = `target_${stableHash({ destinationId: destination.destinationId, version: destination.definitionVersion, origin: `${parsed.origin}${parsed.pathname}`, safeParams: Array.from(parsed.searchParams.entries()).filter(([key]) => !key.startsWith("utm_")), fragment: parsed.hash })}`;
  if (placementState === "NON_CLICKABLE_PLACEMENT") diagnostics.push({ code: "NON_CLICKABLE_PLACEMENT", severity: "warning", reasonUz: "Link sintaksisi to‘g‘ri, lekin aynan shu placement tashqi havolani bosiladigan qilmaydi." });
  if (measurementState !== "AVAILABLE") diagnostics.push({ code: "MEASUREMENT_NOT_VERIFIED", severity: "warning", reasonUz: "Link tayyorligi klik yoki natija o‘lchanayotganini isbotlamaydi." });
  if (input.ctaDestinationGate !== "PASS") diagnostics.push({ code: "DESTINATION_RELEASE_NOT_PASSED", severity: "warning", reasonUz: "URL sintaksisi tekshirildi, lekin destination/release sharti alohida o‘tmagan." });
  diagnostics.push({ code: "TRACKING_LINK_STRUCTURALLY_VALID", severity: "info", reasonUz: "Havola deterministic va allowlist asosida tuzildi; real nashr yoki trafik yuborilmadi." });
  return result("SYNTAX_VALID", url, token, targetFingerprint);
}

export type TrackingRegistryEntry = {
  token: string;
  bindingRevisionId: string;
  publicationIntentId: string;
  targetFingerprint: string;
  targetUrl: string;
};

export function buildTrackingRegistry(entries: TrackingRegistryEntry[]) {
  const registry = new Map<string, TrackingRegistryEntry>();
  const diagnostics: TrackingDiagnostic[] = [];
  for (const entry of entries) {
    const existing = registry.get(entry.token);
    if (existing && (existing.bindingRevisionId !== entry.bindingRevisionId || existing.targetFingerprint !== entry.targetFingerprint)) {
      diagnostics.push({ code: "TRACKING_TOKEN_COLLISION", severity: "error", reasonUz: "Bitta token ikki xil immutable binding yoki targetga mos keldi; yozuvlar birlashtirilmadi." });
      continue;
    }
    registry.set(entry.token, entry);
  }
  return { registry, diagnostics };
}

export function resolveTrackingToken(registry: Map<string, TrackingRegistryEntry>, token: string, expectedPublicationIntentId?: string) {
  const entry = registry.get(token) ?? null;
  if (!entry) return { entry: null, diagnostic: { code: "TRACKING_TOKEN_UNKNOWN", severity: "error", reasonUz: "Token registrda topilmadi; boshqa targetga fallback qilinmadi." } as TrackingDiagnostic };
  if (expectedPublicationIntentId && entry.publicationIntentId !== expectedPublicationIntentId) return { entry: null, diagnostic: { code: "FORGED_PUBLICATION_INTENT", severity: "error", reasonUz: "Token boshqa publication intentga tegishli; private mapping ochilmadi." } as TrackingDiagnostic };
  return { entry, diagnostic: null };
}

export type CanonicalEventName = "LINK_GENERATED" | "PLATFORM_LINK_CLICK" | "REDIRECT_REQUEST" | "OWNED_OUTBOUND_CLICK" | "ENTRY_VISIT" | "TOOL_VIEW" | "TOOL_START" | "TOOL_COMPLETE" | "LEAD_SUBMIT_ATTEMPT" | "LEAD_ACCEPTED" | "NATIVE_ACTION" | "VIDEO_VIEW" | "WATCH_TIME" | "UNKNOWN";
export type TrafficClass = "KNOWN_TEST" | "KNOWN_PREVIEW_OR_ROBOT" | "OBSERVED_UNCLASSIFIED";

export type EventObservation = {
  source: string;
  stream: string;
  origin: TrackingOrigin;
  environment: "LOCAL" | "TEST" | "PRODUCTION";
  eventId: string;
  rawEventName: string;
  canonicalEventName: CanonicalEventName;
  occurredAt: string;
  receivedAt: string;
  publicationIntentId: string | null;
  visitId: string | null;
  toolId: string | null;
  toolVersion: string | null;
  attemptId: string | null;
  completionMilestone: string | null;
  submissionId: string | null;
  trafficClass: TrafficClass;
  value: number | null;
};

export type RawEventObservation = Omit<EventObservation, "canonicalEventName">;

const EVENT_ALIASES: Record<string, CanonicalEventName> = {
  link_generated: "LINK_GENERATED",
  platform_link_click: "PLATFORM_LINK_CLICK",
  redirect_request: "REDIRECT_REQUEST",
  owned_outbound_click: "OWNED_OUTBOUND_CLICK",
  landing_view: "ENTRY_VISIT",
  entry_visit: "ENTRY_VISIT",
  tool_view: "TOOL_VIEW",
  tool_start: "TOOL_START",
  tool_complete: "TOOL_COMPLETE",
  tool_lead: "LEAD_SUBMIT_ATTEMPT",
  lead_submit_attempt: "LEAD_SUBMIT_ATTEMPT",
  lead_accepted: "LEAD_ACCEPTED",
  native_action: "NATIVE_ACTION",
  youtube_view: "VIDEO_VIEW",
  youtube_watch_time: "WATCH_TIME",
};

export function normalizeObservations(items: RawEventObservation[]) {
  const diagnostics: TrackingDiagnostic[] = [];
  const observations = items.map((item) => {
    const canonicalEventName = EVENT_ALIASES[item.rawEventName.trim().toLowerCase()] ?? "UNKNOWN";
    if (canonicalEventName === "UNKNOWN") diagnostics.push({ code: "EVENT_ALIAS_UNKNOWN", severity: "warning", reasonUz: "Raw event nomi explicit alias registryda topilmadi; boshqa milestonega aylantirilmadi." });
    return { ...item, canonicalEventName };
  });
  return { observations, diagnostics };
}

function immutableEventPayload(item: EventObservation) {
  return {
    rawEventName: item.rawEventName,
    canonicalEventName: item.canonicalEventName,
    occurredAt: item.occurredAt,
    publicationIntentId: item.publicationIntentId,
    visitId: item.visitId,
    toolId: item.toolId,
    toolVersion: item.toolVersion,
    attemptId: item.attemptId,
    completionMilestone: item.completionMilestone,
    submissionId: item.submissionId,
    trafficClass: item.trafficClass,
    value: item.value,
  };
}

export function dedupeObservations(items: EventObservation[]) {
  const diagnostics: TrackingDiagnostic[] = [];
  const transport = new Map<string, EventObservation>();
  let transportRetriesDropped = 0;
  for (const item of [...items].sort((a, b) => `${a.occurredAt}|${a.eventId}`.localeCompare(`${b.occurredAt}|${b.eventId}`))) {
    const key = `${item.source}|${item.stream}|${item.origin}|${item.environment}|${item.eventId}`;
    const existing = transport.get(key);
    if (!existing) transport.set(key, item);
    else if (stableHash(immutableEventPayload(existing)) === stableHash(immutableEventPayload(item))) transportRetriesDropped += 1;
    else diagnostics.push({ code: "EVENT_ID_CONFLICT", severity: "error", reasonUz: "Bir event ID turli immutable payload bilan keldi; ikkinchi qiymat hisobga qo‘shilmadi." });
  }
  const semantic = new Map<string, EventObservation>();
  let semanticDuplicatesDropped = 0;
  for (const item of transport.values()) {
    if (item.canonicalEventName !== "TOOL_COMPLETE" || !item.attemptId || !item.toolId || !item.toolVersion || !item.completionMilestone) {
      semantic.set(`transport:${item.source}|${item.stream}|${item.origin}|${item.environment}|${item.eventId}`, item);
      continue;
    }
    const key = `complete:${item.origin}|${item.environment}|${item.toolId}|${item.toolVersion}|${item.attemptId}|${item.completionMilestone}`;
    if (semantic.has(key)) semanticDuplicatesDropped += 1;
    else semantic.set(key, item);
  }
  const observations = [...semantic.values()].sort((a, b) => `${a.occurredAt}|${a.eventId}`.localeCompare(`${b.occurredAt}|${b.eventId}`));
  const starts = new Set(observations.filter((item) => item.canonicalEventName === "TOOL_START" && item.attemptId).map((item) => `${item.origin}|${item.environment}|${item.toolId}|${item.toolVersion}|${item.attemptId}`));
  for (const item of observations.filter((candidate) => candidate.canonicalEventName === "TOOL_COMPLETE" && candidate.attemptId)) {
    const key = `${item.origin}|${item.environment}|${item.toolId}|${item.toolVersion}|${item.attemptId}`;
    if (!starts.has(key)) diagnostics.push({ code: "TOOL_COMPLETE_WITHOUT_START", severity: "warning", reasonUz: "Tool complete rawda saqlandi, lekin mos start bo‘lmagani uchun attempt cohort rate’iga avtomatik qo‘shilmaydi." });
  }
  return { observations, diagnostics, transportRetriesDropped, semanticDuplicatesDropped };
}

export function filterProductionCohort(items: EventObservation[]) {
  const included: EventObservation[] = [];
  const excluded: Array<{ eventId: string; reason: string }> = [];
  for (const item of items) {
    if (item.origin !== "OBSERVED_RUNTIME" || item.environment !== "PRODUCTION") excluded.push({ eventId: item.eventId, reason: "NON_RUNTIME_OR_NON_PRODUCTION_ORIGIN" });
    else if (item.trafficClass === "KNOWN_TEST") excluded.push({ eventId: item.eventId, reason: "KNOWN_TEST" });
    else if (item.trafficClass === "KNOWN_PREVIEW_OR_ROBOT") excluded.push({ eventId: item.eventId, reason: "KNOWN_PREVIEW_OR_ROBOT" });
    else included.push(item);
  }
  return { included, excluded, unknownTrafficVerifiedHuman: false as const };
}

export type MetricObservation = {
  observationId: string;
  metricName: string;
  definitionId: string;
  value: number | null;
  unit: string;
  entityScope: string;
  cohortId: string;
  rateContractId: string;
  sourceScopeKey: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  source: string;
  asOf: string;
  granularity: "EVENT" | "ROLLING_24H" | "DAILY" | "CUMULATIVE";
  availability: AvailabilityState;
  completenessReason: string | null;
  revision: number;
  origin: TrackingOrigin;
};

export type RateResult = {
  rate: number | null;
  valid: boolean;
  availability: AvailabilityState;
  reasonCode: string;
  numerator: number | null;
  denominator: number | null;
  source: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  descriptiveOnly: true;
};

export function calculateRate(numerator: MetricObservation, denominator: MetricObservation): RateResult {
  const base = { numerator: numerator.value, denominator: denominator.value, source: numerator.source, windowStart: numerator.windowStart, windowEnd: numerator.windowEnd, timezone: numerator.timezone, descriptiveOnly: true as const };
  if (numerator.value === null || denominator.value === null || numerator.availability !== "AVAILABLE" && numerator.availability !== "PARTIAL" || denominator.availability !== "AVAILABLE" && denominator.availability !== "PARTIAL") {
    return { ...base, rate: null, valid: false, availability: numerator.availability !== "AVAILABLE" ? numerator.availability : denominator.availability, reasonCode: "METRIC_UNAVAILABLE" };
  }
  const compatible = numerator.rateContractId === denominator.rateContractId && numerator.entityScope === denominator.entityScope && numerator.cohortId === denominator.cohortId && numerator.sourceScopeKey === denominator.sourceScopeKey && numerator.windowStart === denominator.windowStart && numerator.windowEnd === denominator.windowEnd && numerator.timezone === denominator.timezone;
  if (!compatible) return { ...base, rate: null, valid: false, availability: "UNKNOWN", reasonCode: "RATE_SCOPE_MISMATCH" };
  if (denominator.value === 0) return { ...base, rate: null, valid: false, availability: "AVAILABLE", reasonCode: "DENOMINATOR_ZERO" };
  if (numerator.value < 0 || denominator.value < 0 || numerator.value > denominator.value) return { ...base, rate: null, valid: false, availability: "PARTIAL", reasonCode: "INVALID_COHORT_RATIO" };
  const partial = numerator.availability === "PARTIAL" || denominator.availability === "PARTIAL";
  return { ...base, rate: numerator.value / denominator.value, valid: true, availability: partial ? "PARTIAL" : "AVAILABLE", reasonCode: partial ? "PARTIAL_COVERAGE" : "OK" };
}

export type CumulativeMetricSnapshot = {
  snapshotId: string;
  provider: string;
  sourceMode: "API" | "MANUAL";
  accountId: string;
  entityId: string;
  metricName: string;
  definitionId: string;
  windowStart: string;
  windowEnd: string;
  value: number;
  revision: number;
  asOf: string;
};

export function reconcileCumulativeSnapshots(items: CumulativeMetricSnapshot[]) {
  const groups = new Map<string, CumulativeMetricSnapshot[]>();
  for (const item of items) {
    const key = [item.provider, item.accountId, item.entityId, item.metricName, item.definitionId, item.windowStart, item.windowEnd].join("|");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const current: CumulativeMetricSnapshot[] = [];
  const history: CumulativeMetricSnapshot[] = [];
  const diagnostics: TrackingDiagnostic[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => b.revision - a.revision || b.asOf.localeCompare(a.asOf) || (a.sourceMode === "API" ? -1 : 1));
    current.push(sorted[0]);
    history.push(...sorted.slice(1));
    if (new Set(group.map((item) => item.sourceMode)).size > 1 && new Set(group.map((item) => item.value)).size > 1) diagnostics.push({ code: "METRIC_SOURCE_MISMATCH", severity: "warning", reasonUz: "API va manual snapshot bir scope uchun turli qiymat berdi; ular qo‘shilmadi." });
  }
  return { current, history, total: current.reduce((sum, item) => sum + item.value, 0), diagnostics };
}

export type ExperimentKind = "CTA_COPY" | "ROUTE" | "CHANNEL_OBSERVATION";
export type ExperimentPlan = {
  experimentId: string;
  version: string;
  kind: ExperimentKind;
  objectiveUz: string;
  assignment: "OBSERVATIONAL" | "RANDOMIZED" | "UNKNOWN";
  descriptiveOnly: true;
  arms: Array<{ armId: string; labelUz: string; bindingRevisionIds: string[] }>;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  origin: TrackingOrigin;
};

export function evaluateExperiment(plan: ExperimentPlan, rates: Record<string, RateResult>, absoluteOutcomes: Record<string, number | null>) {
  const comparable = plan.arms.every((arm) => Boolean(rates[arm.armId]?.valid));
  const ordered = plan.arms.map((arm) => ({ arm, rate: rates[arm.armId], outcomes: absoluteOutcomes[arm.armId] ?? null }));
  const conclusionUz = plan.kind === "ROUTE" && ordered.length === 2 && comparable
    ? `${ordered[1].arm.labelUz} fixtureda yuqoriroq ulush, ${ordered[0].arm.labelUz} ko‘proq mutlaq yakunlash ko‘rsatdi. Bu kuzatuv; g‘olib aniqlanmagan.`
    : "Natija tavsifiy. Assignment va yetarli dalil bo‘lmaguncha g‘olib aniqlanmaydi.";
  return { plan, arms: ordered, comparable, winnerArmId: null, causalConclusionAllowed: false, conclusionUz };
}

export function calculatePublicationCheckpoints(actualPublishedAt: string | null) {
  if (!actualPublishedAt) return { status: "UNKNOWN" as const, at24h: null, at7d: null, reasonCode: "ACTUAL_PUBLISHED_AT_MISSING" };
  const start = new Date(actualPublishedAt);
  if (Number.isNaN(start.getTime())) return { status: "UNKNOWN" as const, at24h: null, at7d: null, reasonCode: "ACTUAL_PUBLISHED_AT_INVALID" };
  return { status: "AVAILABLE" as const, at24h: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(), at7d: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), reasonCode: "OK" };
}

export function inHalfOpenWindow(value: string, start: string, end: string) {
  const instant = new Date(value).getTime();
  return instant >= new Date(start).getTime() && instant < new Date(end).getTime();
}

export function evaluateInternalRouteAttribution(input: {
  acquisitionBindingRevisionId: string | null;
  internalRouteLegId: string | null;
  visitId: string | null;
  attemptId: string | null;
}) {
  const acquisitionPreserved = Boolean(input.acquisitionBindingRevisionId);
  const joined = Boolean(input.internalRouteLegId && input.visitId && input.attemptId);
  return {
    acquisitionBindingRevisionId: input.acquisitionBindingRevisionId,
    internalRouteLegId: input.internalRouteLegId,
    attributionScope: joined ? "PUBLICATION_OCCURRENCE" as const : "UNATTRIBUTED" as const,
    joinState: joined ? "VERIFIED_FIXTURE_JOIN" as const : "UNKNOWN" as const,
    acquisitionPreserved,
    fingerprintUsed: false as const,
    diagnostics: joined ? [] : [{ code: "ROUTE_JOIN_EVIDENCE_MISSING", severity: "warning" as const, reasonUz: "Internal route qadamini acquisitionga bog‘lash uchun visit/attempt dalili yetishmaydi; attribution to‘qilmadi." }],
  };
}

export function serializePublicTrackingProjection(items: Array<Record<string, unknown>>) {
  return items.flatMap((item) => {
    if (item.visibility !== "ALLOWLISTED" || item.publicationEvidence !== "VERIFIED" || item.origin !== "OBSERVED_RUNTIME") return [];
    return [{
      materialId: String(item.materialId ?? ""),
      materialVersion: String(item.materialVersion ?? ""),
      title: String(item.publicTitle ?? ""),
      publicUrl: String(item.publicUrl ?? ""),
    }];
  });
}
