import { stableHash } from "./catalog-adapter";

export const ASSISTANT_CONTEXT_CONTRACT_VERSION = "co-s4.assistant-context.v1";
export const ASSISTANT_COMMON_VERSION = "co-s4.common.draft.v1";

export type AssistantMode = "CREATE" | "REVIEW" | "IDEATE";
export type AssistantInstructionState = "DRAFT" | "USER_REVIEW_PENDING" | "APPROVED";
export type AssistantLinkState = "NOT_PROVIDED" | "UNVERIFIED" | "DENIED" | "AVAILABLE";
export type AssistantQualityEvidence = "NOT_RUN" | "DRAFT_EXAMPLE" | "HUMAN_REVIEWED";
export type AssistantInvocationType = "PROMPT_CONTEXT_COPY" | "EXISTING_EXTERNAL_HELPER_BRIDGE";
export type SourceCoverage = "FULL" | "EXCERPT" | "MISSING";
export type SourceFreshness = "CURRENT" | "STALE_RECHECK" | "FRESHNESS_UNKNOWN";

export type AssistantDefinition = {
  assistantId: string;
  nameUz: string;
  ownerRole: "Content marketer" | "Digital marketer";
  supportedModes: AssistantMode[];
  instructionVersion: string;
  commonVersion: typeof ASSISTANT_COMMON_VERSION;
  instructionState: AssistantInstructionState;
  methodStatus: string;
  invocationType: AssistantInvocationType;
  helperUrl: string | null;
  linkState: AssistantLinkState;
  qualityEvidence: AssistantQualityEvidence;
  goalUz: string;
  stepsUz: string[];
  modulePrompt: string;
  outputUz: string;
  selfCheckUz: string[];
  examples: {
    goodUz: string;
    badUz: string;
    authority: "METHODOLOGY_DRAFT" | "HISTORICAL_USER_EXAMPLE" | "EXISTING_HELPER_UNKNOWN";
  };
};

export type AssistantStageMapping = {
  semanticStageId: string;
  semanticStageUz: string;
  assistantId: string;
  taskTemplateId: string | null;
  workflowStepId: string | null;
  resolution: "LOCAL_SEMANTIC_DEMO" | "EXACT_TEMPLATE_REFERENCE";
};

export type ContextDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  reasonUz: string;
};

export type AssistantContextInput = {
  contextId: string;
  assistantId: string;
  instructionVersion: string;
  mode: AssistantMode;
  business: {
    problemRefs: string[];
    angleRef: string | null;
    questionUz: string;
    outcomeUz: string;
    audienceUz: string;
    scopeBoundaryUz: string;
  };
  source: {
    sourceEntityId: string | null;
    pinnedVersion: string | null;
    observedCurrentVersion: string | null;
    coverage: SourceCoverage;
    selectedSectionUz: string | null;
    allowedText: string | null;
    missingPartsUz: string[];
    exportApproved: boolean;
  };
  material: {
    materialId: string | null;
    materialVersion: string | null;
    referenceKind: "TRAINING_REF" | "RUNTIME_REF" | "PREVIEW_REF";
  };
  cta: {
    ctaVariantId: string | null;
    ctaVariantVersion: string | null;
    primaryAction: string | null;
    copyUz: string | null;
    placementSummaryUz: string | null;
  };
  destination: {
    destinationId: string | null;
    definitionVersion: string | null;
    nativeTarget: string | null;
    gate: "PASS" | "BLOCKED" | "UNKNOWN";
    reasonUz: string;
  };
  relatedContent: Array<{
    sourceEntityId: string;
    sourceVersion: string | null;
    sourceUrl: string | null;
    sectionOrTimecode: string | null;
    frameNoteUz: string | null;
    purposeUz: string;
  }>;
  method: {
    acceptedRulesUz: string[];
    proposedPatternsUz: string[];
    exampleStatus: string;
  };
  provenance: {
    origin: "LOCAL_REGRESSION_FIXTURE" | "DEMO_CP070" | "TRAINING_DRAFT" | "CONNECTOR_LIVE_READ";
    sourceSnapshotRef: string;
    configManifestRef: string;
    assembledAt: string;
  };
  privateFields?: {
    employeeId?: string;
    telegramId?: string;
    email?: string;
    phone?: string;
    internalNotes?: string;
    cost?: string;
    serviceAccountKey?: string;
    rawEvidence?: unknown;
  };
};

export type AssistantContextEnvelope = {
  contractVersion: typeof ASSISTANT_CONTEXT_CONTRACT_VERSION;
  contextId: string;
  contextFingerprint: string;
  contextRevision: string;
  assistantId: string;
  instructionVersion: string;
  mode: AssistantMode;
  freshness: SourceFreshness;
  sourceCoverage: SourceCoverage;
  diagnostics: ContextDiagnostic[];
  exportProjection: {
    identification: {
      contractVersion: typeof ASSISTANT_CONTEXT_CONTRACT_VERSION;
      contextId: string;
      assistantId: string;
      instructionVersion: string;
      mode: AssistantMode;
    };
    business: AssistantContextInput["business"];
    source: {
      sourceEntityId: string | null;
      pinnedVersion: string | null;
      coverage: SourceCoverage;
      selectedSectionUz: string | null;
      allowedText: string | null;
      missingPartsUz: string[];
      freshness: SourceFreshness;
    };
    material: AssistantContextInput["material"];
    cta: AssistantContextInput["cta"];
    destination: AssistantContextInput["destination"];
    relatedContent: AssistantContextInput["relatedContent"];
    method: AssistantContextInput["method"];
    provenance: AssistantContextInput["provenance"];
    boundary: {
      advisoryOnly: true;
      executionAllowed: false;
      externalHelperReceivesContextAutomatically: false;
      resultIsApproval: false;
    };
  };
};

export type ManualAssistantResult = {
  resultId: string;
  origin: "MANUAL_PASTE";
  storage: "LOCAL_SESSION_ONLY";
  authority: "ADVISORY_ONLY";
  contextFingerprint: string;
  contextId: string;
  assistantId: string;
  instructionVersion: string;
  mode: AssistantMode;
  text: string;
  selected: boolean;
  writtenToSheet: false;
  writtenToBackend: false;
  createsTask: false;
  createsApproval: false;
};

function computeFreshness(source: AssistantContextInput["source"]): SourceFreshness {
  if (!source.observedCurrentVersion) return "FRESHNESS_UNKNOWN";
  if (!source.pinnedVersion || source.pinnedVersion !== source.observedCurrentVersion) return "STALE_RECHECK";
  return "CURRENT";
}

function buildDiagnostics(input: AssistantContextInput, freshness: SourceFreshness): ContextDiagnostic[] {
  const diagnostics: ContextDiagnostic[] = [];
  if (input.source.coverage === "MISSING") diagnostics.push({ code: "SOURCE_BODY_MISSING", severity: "warning", reasonUz: "Manba URL yoki reference’i matn o‘qilganini isbotlamaydi; ruxsatli source body berilmagan." });
  if (input.source.coverage === "EXCERPT") diagnostics.push({ code: "SOURCE_EXCERPT_ONLY", severity: "info", reasonUz: "Faqat tanlangan parcha berilgan; to‘liq manba tekshirildi deb bo‘lmaydi." });
  if (!input.source.exportApproved && input.source.allowedText) diagnostics.push({ code: "SOURCE_EXPORT_NOT_APPROVED", severity: "warning", reasonUz: "Source matni export uchun tasdiqlanmagan va copy payloadidan chiqarildi." });
  if (freshness === "STALE_RECHECK") diagnostics.push({ code: "PINNED_SOURCE_STALE", severity: "warning", reasonUz: "Pinned source versiyasi kuzatilgan joriy versiyadan farq qiladi; eski context o‘zgarmaydi, yangi revision kerak." });
  if (freshness === "FRESHNESS_UNKNOWN") diagnostics.push({ code: "SOURCE_FRESHNESS_UNKNOWN", severity: "info", reasonUz: "Joriy source versiyasi tekshirilmagan; hidden latest ishlatilmadi." });
  if (!input.cta.primaryAction) diagnostics.push({ code: "CTA_PRIMARY_MISSING", severity: "warning", reasonUz: "Draft ko‘rinishi mumkin, lekin primary CTA yo‘q bo‘lsa nashr-ready emas." });
  if (input.destination.gate !== "PASS") diagnostics.push({ code: `DESTINATION_${input.destination.gate}`, severity: input.destination.gate === "BLOCKED" ? "warning" : "info", reasonUz: input.destination.reasonUz });
  diagnostics.push({ code: "ADVISORY_NO_EXECUTION", severity: "info", reasonUz: "Yordamchi natijasi task, approval, material activation yoki nashr yaratmaydi." });
  return diagnostics;
}

export function buildAssistantContextEnvelope(input: AssistantContextInput): AssistantContextEnvelope {
  const freshness = computeFreshness(input.source);
  const exportProjection: AssistantContextEnvelope["exportProjection"] = {
    identification: {
      contractVersion: ASSISTANT_CONTEXT_CONTRACT_VERSION,
      contextId: input.contextId,
      assistantId: input.assistantId,
      instructionVersion: input.instructionVersion,
      mode: input.mode,
    },
    business: structuredClone(input.business),
    source: {
      sourceEntityId: input.source.sourceEntityId,
      pinnedVersion: input.source.pinnedVersion,
      coverage: input.source.coverage,
      selectedSectionUz: input.source.selectedSectionUz,
      allowedText: input.source.exportApproved ? input.source.allowedText : null,
      missingPartsUz: [...input.source.missingPartsUz],
      freshness,
    },
    material: structuredClone(input.material),
    cta: structuredClone(input.cta),
    destination: structuredClone(input.destination),
    relatedContent: input.relatedContent.map((item) => ({ ...item })),
    method: structuredClone(input.method),
    provenance: structuredClone(input.provenance),
    boundary: {
      advisoryOnly: true,
      executionAllowed: false,
      externalHelperReceivesContextAutomatically: false,
      resultIsApproval: false,
    },
  };
  const contextFingerprint = stableHash(exportProjection);
  return {
    contractVersion: ASSISTANT_CONTEXT_CONTRACT_VERSION,
    contextId: input.contextId,
    contextFingerprint,
    contextRevision: `${input.contextId}@${contextFingerprint}`,
    assistantId: input.assistantId,
    instructionVersion: input.instructionVersion,
    mode: input.mode,
    freshness,
    sourceCoverage: input.source.coverage,
    diagnostics: buildDiagnostics(input, freshness),
    exportProjection,
  };
}

export function serializeAssistantContext(envelope: AssistantContextEnvelope) {
  return JSON.stringify(envelope.exportProjection, null, 2);
}

export function buildPromptAndContext(definition: AssistantDefinition, envelope: AssistantContextEnvelope, commonPrompt: string) {
  return [
    `COMMON (${definition.commonVersion})`,
    commonPrompt.trim(),
    `\nMODULE (${definition.instructionVersion})`,
    definition.modulePrompt.trim(),
    `\nCONTEXT (${envelope.contextFingerprint})`,
    serializeAssistantContext(envelope),
  ].join("\n");
}

function isPrivateNetworkHost(hostname: string) {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "0.0.0.0" || lower === "::1" || lower.endsWith(".local") || /^127\./.test(lower) || /^10\./.test(lower) || /^192\.168\./.test(lower) || /^169\.254\./.test(lower);
}

export function resolveHelperLink(definition: Pick<AssistantDefinition, "helperUrl" | "linkState">) {
  if (!definition.helperUrl || definition.linkState === "NOT_PROVIDED") return { state: "MISSING" as const, openable: false, url: null, connected: false, contextAutoSent: false as const };
  let parsed: URL;
  try { parsed = new URL(definition.helperUrl); } catch { return { state: "UNSAFE" as const, openable: false, url: null, connected: false, contextAutoSent: false as const }; }
  if (parsed.protocol !== "https:" || isPrivateNetworkHost(parsed.hostname) || parsed.username || parsed.password) return { state: "UNSAFE" as const, openable: false, url: null, connected: false, contextAutoSent: false as const };
  if (definition.linkState === "DENIED") return { state: "DENIED" as const, openable: false, url: parsed.toString(), connected: false, contextAutoSent: false as const };
  if (definition.linkState === "AVAILABLE") return { state: "AVAILABLE" as const, openable: true, url: parsed.toString(), connected: true, contextAutoSent: false as const };
  return { state: "UNVERIFIED" as const, openable: true, url: parsed.toString(), connected: false, contextAutoSent: false as const };
}

export function resolveAssistantForStage(input: { semanticStageId: string | null; taskTemplateId?: string | null; recordType?: string | null }, mappings: AssistantStageMapping[]) {
  if ((input.recordType ?? "").toUpperCase() === "GENERAL") return { state: "UNMAPPED_GENERAL_PRESERVED" as const, assistantId: null, reasonUz: "General task helper mapping bilan overwrite qilinmaydi." };
  const mapping = mappings.find((item) => item.semanticStageId === input.semanticStageId || Boolean(input.taskTemplateId && item.taskTemplateId === input.taskTemplateId));
  if (!mapping) return { state: "UNMAPPED" as const, assistantId: null, reasonUz: "Exact template/stage mapping topilmadi; nomidan taxmin qilinmadi." };
  return { state: mapping.resolution, assistantId: mapping.assistantId, reasonUz: mapping.resolution === "LOCAL_SEMANTIC_DEMO" ? "Lokal semantik demo; real Task_Template_ID emas." : "Exact template reference bilan resolved." };
}

export function createManualAssistantResult(input: { resultId: string; envelope: AssistantContextEnvelope; text: string }): ManualAssistantResult | null {
  const text = input.text.trim();
  if (!text) return null;
  return {
    resultId: input.resultId,
    origin: "MANUAL_PASTE",
    storage: "LOCAL_SESSION_ONLY",
    authority: "ADVISORY_ONLY",
    contextFingerprint: input.envelope.contextFingerprint,
    contextId: input.envelope.contextId,
    assistantId: input.envelope.assistantId,
    instructionVersion: input.envelope.instructionVersion,
    mode: input.envelope.mode,
    text,
    selected: false,
    writtenToSheet: false,
    writtenToBackend: false,
    createsTask: false,
    createsApproval: false,
  };
}

export function reviseManualAssistantResult(result: ManualAssistantResult, text: string, selected = result.selected): ManualAssistantResult {
  return { ...result, text, selected };
}

export function mergeManualAssistantResults(input: { resultId: string; results: ManualAssistantResult[]; envelope: AssistantContextEnvelope }) {
  const selected = input.results.filter((item) => item.selected && item.contextFingerprint === input.envelope.contextFingerprint);
  if (selected.length < 2) return null;
  return createManualAssistantResult({ resultId: input.resultId, envelope: input.envelope, text: selected.map((item, index) => `Variant ${index + 1}\n${item.text}`).join("\n\n") });
}

export function compareResultContext(result: ManualAssistantResult, envelope: AssistantContextEnvelope) {
  return result.contextFingerprint === envelope.contextFingerprint
    ? { state: "CURRENT" as const, reprocessSuggested: false as const }
    : { state: "STALE_CONTEXT" as const, reprocessSuggested: true as const };
}

export function serializePublicAssistantProjection(items: Array<Record<string, unknown>>) {
  return items.flatMap((item) => item.publicationEvidence === "VERIFIED" && item.visibility === "ALLOWLISTED"
    ? [{ materialId: String(item.materialId ?? ""), materialVersion: String(item.materialVersion ?? ""), title: String(item.title ?? ""), publicUrl: String(item.publicUrl ?? "") }]
    : []);
}
