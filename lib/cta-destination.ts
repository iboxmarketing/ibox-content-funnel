export const CTA_DESTINATION_CONTRACT_VERSION = "co-s3.cta-destination.v1";

export const CTA_ACTIONS = [
  "READ_ARTICLE",
  "WATCH_VIDEO",
  "USE_TOOL",
  "GET_TEMPLATE",
  "FOLLOW",
  "COMMENT",
  "SAVE",
  "SHARE",
  "LIKE",
] as const;

export type CtaAction = (typeof CTA_ACTIONS)[number];
export type CtaMode = "RESOURCE" | "NATIVE";
export type DestinationReadiness = "UNKNOWN" | "NOT_READY" | "VERIFIED_READY" | "RECHECK_REQUIRED" | "NOT_APPLICABLE";
export type ContractValidation = "VALID" | "INCOMPLETE" | "INVALID";
export type CtaDestinationGate = "PASS" | "BLOCKED" | "UNKNOWN";
export type OtherChecksState = "ASSESSED" | "NOT_EVALUATED";

const RESOURCE_ACTIONS = new Set<CtaAction>(["READ_ARTICLE", "WATCH_VIDEO", "USE_TOOL", "GET_TEMPLATE"]);
const NATIVE_ACTIONS = new Set<CtaAction>(["FOLLOW", "COMMENT", "SAVE", "SHARE", "LIKE"]);

export type CtaObservation = {
  placement: "ASSET" | "CAPTION" | "BUTTON";
  action: CtaAction;
  copyUz: string;
};

export type CtaVariant = {
  ctaVariantId: string;
  version: string;
  materialId: string;
  materialVersion: string | null;
  primaryAction: CtaAction | null;
  actionMode: CtaMode | null;
  copyUz: string;
  destinationId: string | null;
  destinationDefinitionVersion: string | null;
  nativeTarget: string | null;
  observations: CtaObservation[];
  origin: "DEMO_CP070" | "LOCAL_REGRESSION_FIXTURE" | "CONNECTOR_LIVE_READ";
};

export type DestinationDefinition = {
  destinationId: string;
  definitionVersion: string;
  type: "ARTICLE" | "VIDEO" | "TOOL" | "TEMPLATE";
  targetReference: string;
  promisedOutcomeUz: string;
  language: string;
  audience: string;
  configuredUrl: string | null;
  lifecycleStatus: "DRAFT" | "ACTIVE" | "BACKLOG" | "ARCHIVED";
  provenance: string;
};

export type DestinationReadinessEvidence = {
  destinationId: string;
  definitionVersion: string;
  evidenceId: string;
  evidenceType: "RUNTIME_QA" | "MANUAL_QA" | "HTTP_ONLY" | "SHEET_LABEL_ONLY";
  source: "BACKEND_RUNTIME" | "FIXTURE" | "SHEET_CONFIG";
  observedTargetReference: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
  audienceAccessible: boolean | null;
  promisedOutcomeMatches: boolean | null;
  requiredQaPassed: boolean | null;
  revoked: boolean;
};

export type NativeCapability = {
  channelId: string;
  formatCode: string;
  action: CtaAction;
  supported: boolean | null;
  analyticsCount: number | null;
  evidenceOrigin: "FIXTURE" | "RUNTIME" | "UNKNOWN";
};

export type CtaDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  reasonUz: string;
};

export type CtaEvaluation = {
  contractVersion: typeof CTA_DESTINATION_CONTRACT_VERSION;
  contractValidation: ContractValidation;
  ctaDestinationGate: CtaDestinationGate;
  destinationReadiness: DestinationReadiness;
  otherChecks: OtherChecksState;
  executionAllowed: false;
  diagnostics: CtaDiagnostic[];
};

export type EvaluateCtaInput = {
  variant: CtaVariant;
  destination?: DestinationDefinition | null;
  readinessEvidence?: DestinationReadinessEvidence | null;
  nativeCapability?: NativeCapability | null;
  otherChecks?: OtherChecksState;
};

function expectedMode(action: CtaAction) {
  if (RESOURCE_ACTIONS.has(action)) return "RESOURCE";
  if (NATIVE_ACTIONS.has(action)) return "NATIVE";
  throw new Error(`Noma’lum CTA action: ${String(action)}`);
}

function uniqueObservedActions(variant: CtaVariant) {
  return new Set([
    ...(variant.primaryAction ? [variant.primaryAction] : []),
    ...variant.observations.map((item) => item.action),
  ]);
}

function result(
  contractValidation: ContractValidation,
  ctaDestinationGate: CtaDestinationGate,
  destinationReadiness: DestinationReadiness,
  diagnostics: CtaDiagnostic[],
  otherChecks: OtherChecksState,
): CtaEvaluation {
  return {
    contractVersion: CTA_DESTINATION_CONTRACT_VERSION,
    contractValidation,
    ctaDestinationGate,
    destinationReadiness,
    otherChecks,
    executionAllowed: false,
    diagnostics,
  };
}

/**
 * Pure CO-S3 evaluator. PASS means only the CTA/destination condition passed;
 * it never implies creative approval, schedule eligibility or publication.
 */
export function evaluateCtaDestination(input: EvaluateCtaInput): CtaEvaluation {
  const { variant } = input;
  const otherChecks = input.otherChecks ?? "NOT_EVALUATED";
  const diagnostics: CtaDiagnostic[] = [];

  if (!variant.primaryAction) {
    diagnostics.push({ code: "CTA_PRIMARY_MISSING", severity: "warning", reasonUz: "CTA tanlanmagan. Draft saqlanishi mumkin, lekin nashrga tayyor emas." });
    return result("INCOMPLETE", "BLOCKED", "UNKNOWN", diagnostics, otherChecks);
  }

  const observedActions = uniqueObservedActions(variant);
  if (observedActions.size > 1) {
    diagnostics.push({ code: "CTA_PRIMARY_CONFLICT", severity: "error", reasonUz: "Ko‘rsatiladigan asset, caption yoki buttonda bir-biriga zid primary CTA bor." });
    return result("INVALID", "BLOCKED", variant.actionMode === "NATIVE" ? "NOT_APPLICABLE" : "UNKNOWN", diagnostics, otherChecks);
  }

  const mode = expectedMode(variant.primaryAction);
  if (variant.actionMode !== mode) {
    diagnostics.push({ code: "CTA_MODE_MISMATCH", severity: "error", reasonUz: `${variant.primaryAction} uchun yo‘l turi ${mode} bo‘lishi kerak.` });
    return result("INVALID", "BLOCKED", "UNKNOWN", diagnostics, otherChecks);
  }

  if (!variant.copyUz.trim()) {
    diagnostics.push({ code: "CTA_COPY_MISSING", severity: "warning", reasonUz: "Primary CTA iborasi hali yozilmagan." });
    return result("INCOMPLETE", "BLOCKED", mode === "NATIVE" ? "NOT_APPLICABLE" : "UNKNOWN", diagnostics, otherChecks);
  }

  if (mode === "NATIVE") {
    if (!variant.nativeTarget) {
      diagnostics.push({ code: "NATIVE_TARGET_MISSING", severity: "warning", reasonUz: "Native CTA uchun tegishli publication yoki kanal targeti ko‘rsatilmagan." });
      return result("INCOMPLETE", "BLOCKED", "NOT_APPLICABLE", diagnostics, otherChecks);
    }
    if (variant.destinationId || variant.destinationDefinitionVersion) {
      diagnostics.push({ code: "NATIVE_RESOURCE_CONFLICT", severity: "error", reasonUz: "Native CTA tashqi destination bilan bir primary yo‘lga aralashtirilgan." });
      return result("INVALID", "BLOCKED", "NOT_APPLICABLE", diagnostics, otherChecks);
    }
    if (!input.nativeCapability || input.nativeCapability.supported === null) {
      diagnostics.push({ code: "NATIVE_CAPABILITY_UNKNOWN", severity: "warning", reasonUz: "Bu kanal/formatda native amal qo‘llanishi tasdiqlanmagan; boshqa CTAga fallback qilinmadi." });
      return result("VALID", "UNKNOWN", "NOT_APPLICABLE", diagnostics, otherChecks);
    }
    if (input.nativeCapability.action !== variant.primaryAction || input.nativeCapability.supported === false) {
      diagnostics.push({ code: "NATIVE_CAPABILITY_UNSUPPORTED", severity: "error", reasonUz: "Tanlangan native CTA bu kanal/format fixture’ida qo‘llanmaydi." });
      return result("VALID", "BLOCKED", "NOT_APPLICABLE", diagnostics, otherChecks);
    }
    if (input.nativeCapability.analyticsCount === null) {
      diagnostics.push({ code: "NATIVE_METRIC_UNKNOWN", severity: "info", reasonUz: "Native amal mavjud, analytics miqdori noma’lum; 0 deb olinmadi." });
    }
    return result("VALID", "PASS", "NOT_APPLICABLE", diagnostics, otherChecks);
  }

  if (!variant.destinationId || !variant.destinationDefinitionVersion) {
    diagnostics.push({ code: "RESOURCE_DESTINATION_MISSING", severity: "warning", reasonUz: "Resource CTA uchun destination va uning aniq definition versiyasi kerak." });
    return result("INCOMPLETE", "BLOCKED", "UNKNOWN", diagnostics, otherChecks);
  }
  if (!input.destination || input.destination.destinationId !== variant.destinationId) {
    diagnostics.push({ code: "DESTINATION_DEFINITION_MISSING", severity: "warning", reasonUz: "Tanlangan destination definitioni topilmadi." });
    return result("INCOMPLETE", "BLOCKED", "UNKNOWN", diagnostics, otherChecks);
  }
  if (input.destination.definitionVersion !== variant.destinationDefinitionVersion) {
    diagnostics.push({ code: "DESTINATION_VERSION_MISMATCH", severity: "error", reasonUz: "Bindingdagi destination versiyasi joriy definition bilan mos emas." });
    return result("INVALID", "BLOCKED", "RECHECK_REQUIRED", diagnostics, otherChecks);
  }
  if (!input.destination.configuredUrl) {
    diagnostics.push({ code: "DESTINATION_URL_MISSING", severity: "warning", reasonUz: "Resource destination uchun tashrifchi ochadigan manzil hali berilmagan." });
    return result("INCOMPLETE", "BLOCKED", "UNKNOWN", diagnostics, otherChecks);
  }

  const evidence = input.readinessEvidence;
  if (!evidence) {
    diagnostics.push({ code: "DESTINATION_EVIDENCE_UNKNOWN", severity: "warning", reasonUz: "Joriy target versiyasi uchun QA dalili olinmagan." });
    return result("VALID", "UNKNOWN", "UNKNOWN", diagnostics, otherChecks);
  }
  if (evidence.destinationId !== input.destination.destinationId || evidence.definitionVersion !== input.destination.definitionVersion) {
    diagnostics.push({ code: "DESTINATION_EVIDENCE_STALE", severity: "error", reasonUz: "QA dalili boshqa destination yoki eski definition versiyasiga tegishli." });
    return result("VALID", "BLOCKED", "RECHECK_REQUIRED", diagnostics, otherChecks);
  }
  if (evidence.revoked) {
    diagnostics.push({ code: "DESTINATION_EVIDENCE_REVOKED", severity: "error", reasonUz: "Destination QA dalili bekor qilingan." });
    return result("VALID", "BLOCKED", "RECHECK_REQUIRED", diagnostics, otherChecks);
  }
  if (evidence.evidenceType === "HTTP_ONLY" || evidence.evidenceType === "SHEET_LABEL_ONLY") {
    diagnostics.push({ code: "DESTINATION_EVIDENCE_INSUFFICIENT", severity: "warning", reasonUz: "HTTP javobi yoki Sheetdagi Ready yorlig‘i foydali natija va auditoriya QA dalili emas." });
    return result("VALID", "UNKNOWN", "UNKNOWN", diagnostics, otherChecks);
  }
  if (evidence.audienceAccessible === false || evidence.promisedOutcomeMatches === false || evidence.requiredQaPassed === false) {
    diagnostics.push({ code: "DESTINATION_NOT_READY", severity: "error", reasonUz: "Destination tanlangan auditoriya uchun ochilmaydi yoki va’da qilingan foyda/QA talabiga mos emas." });
    return result("VALID", "BLOCKED", "NOT_READY", diagnostics, otherChecks);
  }
  if (evidence.audienceAccessible !== true || evidence.promisedOutcomeMatches !== true || evidence.requiredQaPassed !== true) {
    diagnostics.push({ code: "DESTINATION_EVIDENCE_INCOMPLETE", severity: "warning", reasonUz: "Destination evidence mavjud, lekin zarur tekshiruvlarning hammasi tasdiqlanmagan." });
    return result("VALID", "UNKNOWN", "UNKNOWN", diagnostics, otherChecks);
  }

  diagnostics.push({ code: "CTA_DESTINATION_GATE_PASSED", severity: "info", reasonUz: "CTA/manzil sharti o‘tdi. Boshqa approval va release shartlari bundan alohida." });
  return result("VALID", "PASS", "VERIFIED_READY", diagnostics, otherChecks);
}

export type PublicationCtaBinding = {
  bindingRevisionId: string;
  bindingSeriesId: string;
  revision: number;
  previousBindingRevisionId: string | null;
  publicationIntentId: string;
  materialId: string;
  materialVersion: string | null;
  ctaVariantId: string;
  ctaVariantVersion: string;
  destinationId: string | null;
  destinationDefinitionVersion: string | null;
  nativeTarget: string | null;
  channelId: string;
  occurrenceId: string;
};

export function createPublicationBinding(input: Omit<PublicationCtaBinding, "bindingRevisionId" | "bindingSeriesId" | "revision" | "previousBindingRevisionId">): PublicationCtaBinding {
  const bindingSeriesId = `bind:${input.publicationIntentId}`;
  return { ...input, bindingSeriesId, bindingRevisionId: `${bindingSeriesId}:r1`, revision: 1, previousBindingRevisionId: null };
}

export function revisePublicationBinding(
  current: PublicationCtaBinding,
  next: Partial<Pick<PublicationCtaBinding, "materialVersion" | "ctaVariantId" | "ctaVariantVersion" | "destinationId" | "destinationDefinitionVersion" | "nativeTarget">>,
) {
  const revision = current.revision + 1;
  const revised: PublicationCtaBinding = {
    ...current,
    ...next,
    revision,
    bindingRevisionId: `${current.bindingSeriesId}:r${revision}`,
    previousBindingRevisionId: current.bindingRevisionId,
  };
  return {
    previous: current,
    revised,
    impact: {
      bindingChanged: true,
      creativeQaRequired: current.ctaVariantId !== revised.ctaVariantId || current.destinationId !== revised.destinationId,
      destinationQaRequired: current.destinationDefinitionVersion !== revised.destinationDefinitionVersion || current.destinationId !== revised.destinationId,
      historicalIntentIdPreserved: current.publicationIntentId === revised.publicationIntentId,
    },
  };
}

export function evaluateDestinationDefinitionChange(input: {
  previous: DestinationDefinition;
  next: DestinationDefinition;
}) {
  const routeChanged = input.previous.configuredUrl !== input.next.configuredUrl || input.previous.targetReference !== input.next.targetReference;
  const promiseChanged = input.previous.promisedOutcomeUz !== input.next.promisedOutcomeUz;
  return {
    definitionRevisionRequired: input.previous.definitionVersion !== input.next.definitionVersion || routeChanged || promiseChanged,
    routeRecheckRequired: routeChanged || promiseChanged,
    creativeReviewRequired: promiseChanged,
    automaticReshootRequired: false,
    previousVersionPreserved: true,
  };
}

export type DestinationImpactReference = {
  referenceId: string;
  destinationId: string;
  destinationDefinitionVersion: string;
  materialId: string;
  ctaVariantId: string;
  state: "OPEN_INTENT" | "SCHEDULED" | "PUBLISHED";
};

export function calculateDestinationImpact(input: {
  destinationId: string;
  destinationDefinitionVersion: string;
  readiness: Exclude<DestinationReadiness, "NOT_APPLICABLE">;
  references: DestinationImpactReference[];
  runtimeProjectionAvailable: boolean;
}) {
  const affected = input.references.filter((item) => item.destinationId === input.destinationId && item.destinationDefinitionVersion === input.destinationDefinitionVersion);
  return {
    readonly: true as const,
    externalActionsPerformed: 0 as const,
    realAffectedCount: input.runtimeProjectionAvailable ? affected.length : null,
    countState: input.runtimeProjectionAvailable ? "KNOWN" as const : "UNKNOWN" as const,
    affected: affected.map((item) => ({ ...item, recommendedAction: item.state === "PUBLISHED" ? "LINK_REVIEW" as const : "HOLD_AND_REVIEW" as const })),
  };
}

export type YoutubeDecision = {
  decision: "PENDING" | "YES" | "NO";
  sourceArticleId: string | null;
  sourceArticleVersion: string | null;
  reasonUz: string;
};

export function evaluateYoutubeSourceImpact(decision: YoutubeDecision, currentSource: { sourceArticleId: string; version: string }) {
  if (!decision.sourceArticleId || !decision.sourceArticleVersion) return { state: "INCOMPLETE" as const, hiddenRewrite: false as const };
  if (decision.sourceArticleId !== currentSource.sourceArticleId || decision.sourceArticleVersion !== currentSource.version) {
    return { state: "PINNED_SOURCE_STALE" as const, hiddenRewrite: false as const, pinnedVersion: decision.sourceArticleVersion, availableVersion: currentSource.version };
  }
  return { state: "CURRENT" as const, hiddenRewrite: false as const, pinnedVersion: decision.sourceArticleVersion, availableVersion: currentSource.version };
}

export function applyLongVideoDecision<T extends { id: string; formatCode: string }>(items: T[], decision: YoutubeDecision["decision"]) {
  return items.map((item) => ({
    ...item,
    youtubeState: item.formatCode === "LONG_VIDEO" && decision === "NO" ? "NOT_APPLICABLE" as const : item.formatCode === "LONG_VIDEO" ? "PENDING_DECISION" as const : "INDEPENDENT" as const,
  }));
}

export function serializePublicCtaProjection(items: Array<Record<string, unknown>>) {
  return items.flatMap((item) => {
    if (item.publicationEvidence !== "VERIFIED" || item.visibility !== "ALLOWLISTED") return [];
    return [{
      materialId: String(item.materialId ?? ""),
      materialVersion: String(item.materialVersion ?? ""),
      title: String(item.title ?? ""),
      publicUrl: String(item.publicUrl ?? ""),
      primaryCta: String(item.primaryCta ?? ""),
      destinationUrl: item.destinationUrl ? String(item.destinationUrl) : null,
    }];
  });
}

export function createLocalCtaDraft(variant: CtaVariant) {
  return {
    storage: "LOCAL_SESSION_ONLY" as const,
    writtenToSheet: false as const,
    writtenToBackend: false as const,
    variant: structuredClone(variant),
    evaluation: evaluateCtaDestination({ variant }),
  };
}
