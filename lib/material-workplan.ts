import {
  evaluateCtaDestination,
  type CtaAction,
  type CtaDestinationGate,
  type CtaMode,
  type DestinationDefinition,
  type DestinationReadinessEvidence,
  type NativeCapability,
  type YoutubeDecision,
} from "./cta-destination";

export const MATERIAL_WORKPLAN_CONTRACT_VERSION = "co-s5.material-workplan-preview.v1";

export type PreviewOrigin = "CO_S5_PROPOSAL" | "TRAINING_DRAFT" | "DEMO_CP070" | "LOCAL_REGRESSION_FIXTURE";
export type MaterialFormat = "ARTICLE" | "CAROUSEL" | "TEXT_POST" | "SHORT_VIDEO" | "LONG_VIDEO" | "STATIC" | "TOOL";
export type DraftState = "INCOMPLETE" | "SELECTED_LOCAL" | "ARCHIVED_LOCAL";
export type WorkColumn = "PLANNED" | "IN_PROGRESS" | "REVIEW" | "DONE";
export type ConditionState = "TRUE" | "FALSE" | "UNKNOWN";

export type PublicationIntentDraft = {
  intentId: string;
  channelId: string;
  occurrence: number;
  state: "INTENT_ONLY";
};

export type MaterialDraftSeed = {
  seedId: string;
  origin: PreviewOrigin;
  packageRef: string;
  angleRef: string;
  assistantResultRef: string | null;
  contextFingerprint: string | null;
  titleUz: string;
  questionUz: string;
  outcomeUz: string;
  formatCode: MaterialFormat;
  structureUz: string;
  sourceEntityId: string | null;
  sourceVersion: string | null;
  primaryCta: CtaAction | null;
  ctaMode: CtaMode | null;
  ctaCopyUz: string;
  destinationId: string | null;
  destinationDefinitionVersion: string | null;
  nativeTarget: string | null;
  publicationIntents: PublicationIntentDraft[];
  authorIds: string[];
  selected: boolean;
};

export type MaterialDraftRevision = MaterialDraftSeed & {
  draftSeriesId: string;
  draftRevisionId: string;
  revision: number;
  previousRevisionId: string | null;
  state: DraftState;
  ctaGate: CtaDestinationGate;
  ctaContract: "VALID" | "INCOMPLETE" | "INVALID";
  diagnostics: Array<{ code: string; reasonUz: string }>;
  storage: "LOCAL_SESSION_ONLY";
  writtenToSheet: false;
  writtenToBackend: false;
  createsTask: false;
  createsApproval: false;
  historyReadable: true;
};

export type DraftEvaluationContext = {
  destination?: DestinationDefinition | null;
  readinessEvidence?: DestinationReadinessEvidence | null;
  nativeCapability?: NativeCapability | null;
};

export type StageAssistantMapping = {
  mappingId: string;
  workflowId: string;
  stepId: string;
  taskTemplateId: string;
  workflowVersion: string;
  templateVersion: string;
  scope: string;
  helperId: string;
  helperVersion: string;
  mode: "CREATE" | "REVIEW" | "IDEATE";
  mappingStatus: "PROPOSED" | "EXISTING_BRIDGE";
  sourceTab: "23_TASK_TEMPLATES" | "25_WORKFLOW_STEPS";
  sourceRanges: string[];
  sourceRecordHash: string;
  freshness: "REFERENCE_VERIFIED" | "FRESHNESS_UNKNOWN" | "MAPPING_RECHECK_REQUIRED";
};

export type WorkItem = {
  candidateKey: string;
  scopeType: "PACKAGE" | "MATERIAL" | "SHOOT_SESSION" | "PUBLICATION";
  scopeId: string;
  workflowId: string;
  workflowVersion: string;
  stepId: string;
  taskTemplateId: string | null;
  titleUz: string;
  groupUz: string;
  column: WorkColumn;
  role: "Content marketer" | "Operator / Montajer" | "Digital marketer" | "SEO" | "Head";
  employeeId: string | null;
  estimateMinutes: number | null;
  committedDeadline: string | null;
  forecastAt: string | null;
  requiredOutputUz: string | null;
  requiredChecklistIds: string[];
  dependencies: string[];
  condition: ConditionState;
  conditionReasonUz: string;
  helperId: string | null;
  helperState: "MAPPED_PROPOSED" | "EXISTING_BRIDGE" | "UNMAPPED" | "RECHECK_REQUIRED";
  rawConfigState: "DRAFT";
  executable: false;
  shared: boolean;
  publicationIntentId: string | null;
  whyUz: string;
};

export type WorkPlanProjection = {
  contractVersion: typeof MATERIAL_WORKPLAN_CONTRACT_VERSION;
  projectionId: string;
  selectedMaterialCount: number;
  publicationIntentCount: number;
  realTaskCount: null;
  simulatedWorkItemCount: number;
  items: WorkItem[];
  diagnostics: Array<{ code: string; severity: "info" | "warning" | "error"; reasonUz: string }>;
  writerCalls: 0;
};

function stableHash(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function expectedMode(action: CtaAction | null): CtaMode | null {
  if (!action) return null;
  return ["READ_ARTICLE", "WATCH_VIDEO", "USE_TOOL", "GET_TEMPLATE"].includes(action) ? "RESOURCE" : "NATIVE";
}

export function createMaterialDraft(seed: MaterialDraftSeed, context: DraftEvaluationContext = {}): MaterialDraftRevision {
  const draftSeriesId = `local-proposal:${stableHash([seed.packageRef, seed.angleRef, seed.seedId])}`;
  const mode = seed.primaryCta ? expectedMode(seed.primaryCta) : seed.ctaMode;
  const evaluation = evaluateCtaDestination({
    variant: {
      ctaVariantId: `${draftSeriesId}:cta:r1`,
      version: "local-r1",
      materialId: draftSeriesId,
      materialVersion: "local-r1",
      primaryAction: seed.primaryCta,
      actionMode: mode,
      copyUz: seed.ctaCopyUz,
      destinationId: mode === "RESOURCE" ? seed.destinationId : null,
      destinationDefinitionVersion: mode === "RESOURCE" ? seed.destinationDefinitionVersion : null,
      nativeTarget: mode === "NATIVE" ? seed.nativeTarget : null,
      observations: seed.primaryCta ? [{ placement: "CAPTION", action: seed.primaryCta, copyUz: seed.ctaCopyUz }] : [],
      origin: seed.origin === "DEMO_CP070" ? "DEMO_CP070" : "LOCAL_REGRESSION_FIXTURE",
    },
    destination: context.destination,
    readinessEvidence: context.readinessEvidence,
    nativeCapability: context.nativeCapability,
  });
  const contentComplete = Boolean(seed.titleUz.trim() && seed.questionUz.trim() && seed.outcomeUz.trim() && seed.structureUz.trim());
  return {
    ...structuredClone(seed),
    ctaMode: mode,
    draftSeriesId,
    draftRevisionId: `${draftSeriesId}:r1`,
    revision: 1,
    previousRevisionId: null,
    state: seed.selected && contentComplete && evaluation.contractValidation === "VALID" ? "SELECTED_LOCAL" : "INCOMPLETE",
    ctaGate: evaluation.ctaDestinationGate,
    ctaContract: evaluation.contractValidation,
    diagnostics: [
      ...(!contentComplete ? [{ code: "MATERIAL_CONTENT_INCOMPLETE", reasonUz: "Savol, foyda, sarlavha yoki format rejasi to‘liq emas; draft saqlanishi mumkin." }] : []),
      ...evaluation.diagnostics.map((item) => ({ code: item.code, reasonUz: item.reasonUz })),
    ],
    storage: "LOCAL_SESSION_ONLY",
    writtenToSheet: false,
    writtenToBackend: false,
    createsTask: false,
    createsApproval: false,
    historyReadable: true,
  };
}

export function reviseMaterialDraft(current: MaterialDraftRevision, changes: Partial<MaterialDraftSeed>, context: DraftEvaluationContext = {}) {
  const seed: MaterialDraftSeed = {
    seedId: current.seedId,
    origin: current.origin,
    packageRef: current.packageRef,
    angleRef: current.angleRef,
    assistantResultRef: current.assistantResultRef,
    contextFingerprint: current.contextFingerprint,
    titleUz: current.titleUz,
    questionUz: current.questionUz,
    outcomeUz: current.outcomeUz,
    formatCode: current.formatCode,
    structureUz: current.structureUz,
    sourceEntityId: current.sourceEntityId,
    sourceVersion: current.sourceVersion,
    primaryCta: current.primaryCta,
    ctaMode: current.ctaMode,
    ctaCopyUz: current.ctaCopyUz,
    destinationId: current.destinationId,
    destinationDefinitionVersion: current.destinationDefinitionVersion,
    nativeTarget: current.nativeTarget,
    publicationIntents: current.publicationIntents,
    authorIds: current.authorIds,
    selected: current.selected,
    ...changes,
  };
  const fresh = createMaterialDraft(seed, context);
  const revision = current.revision + 1;
  return {
    previous: structuredClone(current),
    revised: {
      ...fresh,
      draftSeriesId: current.draftSeriesId,
      draftRevisionId: `${current.draftSeriesId}:r${revision}`,
      revision,
      previousRevisionId: current.draftRevisionId,
    },
  };
}

export function archiveMaterialDraft(current: MaterialDraftRevision) {
  const revision = current.revision + 1;
  return {
    previous: structuredClone(current),
    revised: {
      ...structuredClone(current),
      selected: false,
      state: "ARCHIVED_LOCAL" as const,
      revision,
      previousRevisionId: current.draftRevisionId,
      draftRevisionId: `${current.draftSeriesId}:r${revision}`,
      historyReadable: true as const,
    },
  };
}

export function resolveStageAssistant(input: {
  workflowId: string;
  stepId: string;
  taskTemplateId: string;
  workflowVersion: string;
  templateVersion: string;
  scope: string;
  observedSourceHash?: string;
}, mappings: StageAssistantMapping[]) {
  const exact = mappings.find((item) => item.workflowId === input.workflowId
    && item.stepId === input.stepId
    && item.taskTemplateId === input.taskTemplateId
    && item.workflowVersion === input.workflowVersion
    && item.templateVersion === input.templateVersion
    && item.scope === input.scope);
  if (!exact) return { state: "UNMAPPED" as const, helperId: null, mapping: null };
  if (input.observedSourceHash && input.observedSourceHash !== exact.sourceRecordHash) {
    return { state: "MAPPING_RECHECK_REQUIRED" as const, helperId: exact.helperId, mapping: exact };
  }
  return { state: exact.mappingStatus === "EXISTING_BRIDGE" ? "EXISTING_BRIDGE" as const : "MAPPED_PROPOSED" as const, helperId: exact.helperId, mapping: exact };
}

function workKey(scopeType: WorkItem["scopeType"], scopeId: string, workflowId: string, workflowVersion: string, stepId: string, revision = 1) {
  return `preview-work:${stableHash([scopeType, scopeId, workflowId, workflowVersion, stepId, revision])}`;
}

function workItem(input: Omit<WorkItem, "candidateKey" | "rawConfigState" | "executable">): WorkItem {
  return {
    ...input,
    candidateKey: workKey(input.scopeType, input.scopeId, input.workflowId, input.workflowVersion, input.stepId),
    rawConfigState: "DRAFT",
    executable: false,
  };
}

function helperFor(workflowId: string, stepId: string, taskTemplateId: string | null, scope: string, mappings: StageAssistantMapping[]) {
  if (!taskTemplateId) return { helperId: null, helperState: "UNMAPPED" as const };
  const result = resolveStageAssistant({ workflowId, stepId, taskTemplateId, workflowVersion: "v2", templateVersion: "v2", scope }, mappings);
  return { helperId: result.helperId, helperState: result.state === "MAPPING_RECHECK_REQUIRED" ? "RECHECK_REQUIRED" as const : result.state };
}

export function calculateWorkPlan(input: {
  drafts: MaterialDraftRevision[];
  youtubeDecision: YoutubeDecision;
  mappings: StageAssistantMapping[];
  sharedResearchScope: { scopeId: string; sourceEntityId: string | null; sourceVersion: string | null };
  sharedShootSessionId?: string | null;
}): WorkPlanProjection {
  const selected = input.drafts.filter((item) => item.selected && item.state !== "ARCHIVED_LOCAL");
  const diagnostics: WorkPlanProjection["diagnostics"] = [];
  const items: WorkItem[] = [];
  const publicationIntentCount = selected.reduce((count, item) => count + item.publicationIntents.length, 0);
  const sourceMismatch = selected.some((item) => item.sourceEntityId !== input.sharedResearchScope.sourceEntityId || item.sourceVersion !== input.sharedResearchScope.sourceVersion);
  const researchHelper = helperFor("WF-BLOG", "BLOG-02", "TT-02", "PACKAGE", input.mappings);
  items.push(workItem({
    scopeType: "PACKAGE", scopeId: input.sharedResearchScope.scopeId, workflowId: "WF-BLOG", workflowVersion: "v2", stepId: "BLOG-02", taskTemplateId: "TT-02",
    titleUz: sourceMismatch ? "Research qamrovini tekshirish va delta tadqiqot" : "Tayanch researchni tayyorlash", groupUz: "Umumiy ishlar", column: "PLANNED", role: "Content marketer", employeeId: null, estimateMinutes: null, committedDeadline: null, forecastAt: null,
    requiredOutputUz: "Versiyalangan research xulosasi", requiredChecklistIds: ["CK-02"], dependencies: [], condition: "TRUE", conditionReasonUz: "Tanlangan scope uchun umumiy manba kerak.", ...researchHelper, shared: true, publicationIntentId: null,
    whyUz: sourceMismatch ? "Source/scope mosligi noma’lum; global reuse qilinmadi." : "Bir xil tekshirilgan scope/source/version uchun research bir marta.",
  }));
  if (sourceMismatch) diagnostics.push({ code: "SHARED_RESEARCH_SCOPE_MISMATCH", severity: "warning", reasonUz: "Materiallardan kamida bittasi umumiy research source/versioniga mos emas; delta tekshiruvi kerak." });

  const hasShort = selected.some((item) => item.formatCode === "SHORT_VIDEO");
  if (hasShort) {
    const shootId = input.sharedShootSessionId ?? `local-shoot:${stableHash(selected.filter((item) => item.formatCode === "SHORT_VIDEO").map((item) => item.draftSeriesId).sort())}`;
    items.push(workItem({
      scopeType: "SHOOT_SESSION", scopeId: shootId, workflowId: "WF-SHOOT-PACKAGE", workflowVersion: "v2", stepId: "PKG-09", taskTemplateId: "TT-15",
      titleUz: "Tasdiqlangan short scope bo‘yicha syomka", groupUz: "Umumiy ishlar", column: "PLANNED", role: "Operator / Montajer", employeeId: null, estimateMinutes: null, committedDeadline: null, forecastAt: null,
      requiredOutputUz: "Syomka sessiyasi fayllari", requiredChecklistIds: [], dependencies: [], condition: "TRUE", conditionReasonUz: "Tanlangan short materiali bor.", helperId: null, helperState: "UNMAPPED", shared: true, publicationIntentId: null,
      whyUz: "Syomka sessiyasi bitta; har materialning montaji alohida.",
    }));
  }

  for (const draft of selected) {
    if (draft.formatCode === "LONG_VIDEO" && input.youtubeDecision.decision !== "YES") {
      diagnostics.push({ code: input.youtubeDecision.decision === "NO" ? "LONG_PATH_NOT_SELECTED" : "LONG_DECISION_PENDING", severity: "info", reasonUz: `${draft.titleUz}: long yo‘li ${input.youtubeDecision.decision}; mustaqil short/postlar saqlanadi.` });
      continue;
    }
    const isCarousel = draft.formatCode === "CAROUSEL";
    const isShort = draft.formatCode === "SHORT_VIDEO";
    const isText = draft.formatCode === "TEXT_POST";
    const workflowId = isCarousel ? "WF-CAROUSEL" : isShort || draft.formatCode === "LONG_VIDEO" ? "WF-SHOOT-PACKAGE" : isText ? "WF-TEXT" : "WF-BLOG";
    const createStep = isCarousel ? "CAR-03" : isShort ? "PKG-07" : isText ? "TEXT-03" : "BLOG-04";
    const createTemplate = isCarousel ? "TT-08" : isShort ? "TT-14" : isText ? "TT-06" : "TT-04";
    const scope = isShort ? "CHILD_CONTENT" : "CONTENT";
    const helper = helperFor(workflowId, createStep, createTemplate, scope, input.mappings);
    const create = workItem({
      scopeType: "MATERIAL", scopeId: draft.draftSeriesId, workflowId, workflowVersion: "v2", stepId: createStep, taskTemplateId: createTemplate,
      titleUz: `${draft.titleUz} — mazmun`, groupUz: isCarousel ? "Karuselni tayyorlash" : isShort ? "Shortni tayyorlash" : "Materialni tayyorlash", column: "PLANNED", role: "Content marketer", employeeId: null, estimateMinutes: null, committedDeadline: null, forecastAt: null,
      requiredOutputUz: isCarousel ? "Slayd rejasi va copy" : isShort ? "Ssenariy va kadr rejasi" : "Material drafti", requiredChecklistIds: [], dependencies: [items[0].candidateKey], condition: "TRUE", conditionReasonUz: "Material lokal tanlangan.", ...helper, shared: false, publicationIntentId: null,
      whyUz: "Mustaqil topshiriladigan mazmun outputi mavjud.",
    });
    items.push(create);
    if (isShort) {
      const shoot = items.find((item) => item.scopeType === "SHOOT_SESSION");
      items.push(workItem({
        scopeType: "MATERIAL", scopeId: draft.draftSeriesId, workflowId, workflowVersion: "v2", stepId: "PKG-12", taskTemplateId: "TT-18",
        titleUz: `${draft.titleUz} — montaj`, groupUz: "Shortni tayyorlash", column: "PLANNED", role: "Operator / Montajer", employeeId: null, estimateMinutes: null, committedDeadline: null, forecastAt: null,
        requiredOutputUz: "Montaj qilingan video versiyasi", requiredChecklistIds: [], dependencies: [create.candidateKey, ...(shoot ? [shoot.candidateKey] : [])], condition: "TRUE", conditionReasonUz: "Short tanlangan.", helperId: null, helperState: "UNMAPPED", shared: false, publicationIntentId: null,
        whyUz: "Shoot va edit alohida output/ijrochi chegarasi.",
      }));
    }
    const reviewStep = isCarousel ? "CAR-08" : isShort ? "PKG-08" : isText ? "TEXT-04" : "BLOG-05";
    const reviewTemplate = isCarousel ? "TT-25" : isShort ? "TT-11" : isText ? "TT-07" : "TT-05";
    const reviewHelper = helperFor(workflowId, reviewStep, reviewTemplate, scope, input.mappings);
    items.push(workItem({
      scopeType: "MATERIAL", scopeId: draft.draftSeriesId, workflowId, workflowVersion: "v2", stepId: reviewStep, taskTemplateId: reviewTemplate,
      titleUz: `${draft.titleUz} — versiyalangan review`, groupUz: "Tekshiruv", column: "REVIEW", role: isText ? "Head" : "Head", employeeId: null, estimateMinutes: null, committedDeadline: null, forecastAt: null,
      requiredOutputUz: "Bir xil versiya uchun Head va muallif bo‘lmagan CM qarori", requiredChecklistIds: ["AP-FINAL-CREATIVE"], dependencies: items.filter((item) => item.scopeId === draft.draftSeriesId && item.groupUz !== "Tekshiruv").map((item) => item.candidateKey), condition: "TRUE", conditionReasonUz: "Joriy baseline gate saqlangan.", ...reviewHelper, shared: false, publicationIntentId: null,
      whyUz: "Task Done material Approved yoki Published emas.",
    }));
    for (const intent of draft.publicationIntents) {
      items.push(workItem({
        scopeType: "PUBLICATION", scopeId: `${draft.draftSeriesId}:${intent.intentId}`, workflowId: "WF-PUBLISH", workflowVersion: "v2", stepId: "PUB-01", taskTemplateId: "TT-31",
        titleUz: `${draft.titleUz} — ${intent.channelId} moslashtirish`, groupUz: "Kanal nashri", column: "PLANNED", role: draft.formatCode === "ARTICLE" ? "SEO" : "Content marketer", employeeId: null, estimateMinutes: null, committedDeadline: null, forecastAt: null,
        requiredOutputUz: "Kanal occurrence’i uchun tayyor publication bundle", requiredChecklistIds: [], dependencies: items.filter((item) => item.scopeId === draft.draftSeriesId && item.groupUz === "Tekshiruv").map((item) => item.candidateKey), condition: draft.ctaGate === "PASS" ? "TRUE" : draft.ctaGate === "BLOCKED" ? "FALSE" : "UNKNOWN", conditionReasonUz: draft.ctaGate === "PASS" ? "CTA/destination lokal gate o‘tdi; boshqa release shartlari alohida." : "Tegishli CTA/destination gate publicationni kutmoqda.", helperId: null, helperState: "UNMAPPED", shared: false, publicationIntentId: intent.intentId,
        whyUz: "Kanal occurrence’i alohida; research/shoot/main edit qayta yaratilmaydi.",
      }));
    }
  }

  const ordered = items.sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));
  return {
    contractVersion: MATERIAL_WORKPLAN_CONTRACT_VERSION,
    projectionId: `workplan:${stableHash({ selected: selected.map((item) => item.draftRevisionId).sort(), youtube: input.youtubeDecision, keys: ordered.map((item) => item.candidateKey) })}`,
    selectedMaterialCount: selected.length,
    publicationIntentCount,
    realTaskCount: null,
    simulatedWorkItemCount: ordered.length,
    items: ordered,
    diagnostics,
    writerCalls: 0,
  };
}

export function calculateWorkPlanDelta(previous: WorkPlanProjection, next: WorkPlanProjection) {
  const before = new Map(previous.items.map((item) => [item.candidateKey, item]));
  const after = new Map(next.items.map((item) => [item.candidateKey, item]));
  return {
    added: next.items.filter((item) => !before.has(item.candidateKey)),
    removedFromProposal: previous.items.filter((item) => !after.has(item.candidateKey)),
    affected: next.items.filter((item) => before.has(item.candidateKey) && JSON.stringify(before.get(item.candidateKey)) !== JSON.stringify(item)),
    unchanged: next.items.filter((item) => before.has(item.candidateKey) && JSON.stringify(before.get(item.candidateKey)) === JSON.stringify(item)),
    existingRuntimeRecordsChanged: 0 as const,
  };
}

export type CompletionEvidence = {
  outputPresent: boolean;
  requiredChecklistCompleted: boolean;
  condition: ConditionState;
  nAReasonUz?: string | null;
};

export function evaluateCompletion(item: WorkItem, evidence: CompletionEvidence) {
  if (evidence.condition === "UNKNOWN") return { allowed: false as const, outcome: "WAITING" as const, code: "CONDITION_UNKNOWN", reasonUz: "Shart noma’lum; bajarildi yoki N/A deb olinmaydi." };
  if (evidence.condition === "FALSE") {
    if (!evidence.nAReasonUz?.trim()) return { allowed: false as const, outcome: "WAITING" as const, code: "NA_REASON_REQUIRED", reasonUz: "False shart uchun sababli N/A izohi kerak." };
    return { allowed: true as const, outcome: "NOT_APPLICABLE" as const, code: "CONDITION_FALSE_REASONED", reasonUz: "Shart false; bu Done emas, sababli N/A." };
  }
  if (item.requiredOutputUz && !evidence.outputPresent) return { allowed: false as const, outcome: "REJECTED" as const, code: "REQUIRED_OUTPUT_MISSING", reasonUz: "Zarur output mavjud emas." };
  if (item.requiredChecklistIds.length && !evidence.requiredChecklistCompleted) return { allowed: false as const, outcome: "REJECTED" as const, code: "REQUIRED_CHECKLIST_MISSING", reasonUz: "Applicable required checklist tugallanmagan." };
  return { allowed: true as const, outcome: "DONE_SIMULATED" as const, code: "COMPLETION_SIMULATED", reasonUz: "Faqat lokal demo holati; material approvali yoki publication emas." };
}

export function simulateWorkItemMove(item: WorkItem, target: WorkColumn, evidence: CompletionEvidence) {
  if (target !== "DONE") return { allowed: true as const, nextColumn: target, code: "DEMO_MOVE", writes: 0 as const };
  const gate = evaluateCompletion(item, evidence);
  return { allowed: gate.allowed, nextColumn: gate.allowed && gate.outcome === "DONE_SIMULATED" ? "DONE" as const : item.column, code: gate.code, reasonUz: gate.reasonUz, writes: 0 as const };
}

export function evaluateVersionedReview(input: {
  materialVersion: string;
  authorIds: string[];
  decisions: Array<{ reviewerId: string; reviewerRole: "Head" | "Content marketer"; version: string; decision: "APPROVE" | "REJECT" }>;
}) {
  const currentApprovals = input.decisions.filter((item) => item.version === input.materialVersion && item.decision === "APPROVE");
  const head = currentApprovals.some((item) => item.reviewerRole === "Head" && !input.authorIds.includes(item.reviewerId));
  const independentCm = currentApprovals.some((item) => item.reviewerRole === "Content marketer" && !input.authorIds.includes(item.reviewerId));
  return {
    ready: head && independentCm,
    headCurrentVersion: head,
    independentCmCurrentVersion: independentCm,
    code: head && independentCm ? "REVIEW_READY" as const : "REVIEW_NOT_READY" as const,
    inheritedApprovalCount: 0 as const,
  };
}

export function validatePreviewAssignment(input: { employeeId: string | null; employeeRole: string | null; requiredRole: string; recordType?: string }) {
  if (!input.employeeId) return { valid: false as const, code: "UNASSIGNED" as const };
  if (input.employeeId.startsWith("ROLE-") || input.recordType === "ROLE_PLACEHOLDER") return { valid: false as const, code: "ROLE_PLACEHOLDER_NOT_IDENTITY" as const };
  if (["SMM manager", "Developer"].includes(input.employeeRole ?? "")) return { valid: false as const, code: "LEGACY_ROLE_NOT_ALLOWED" as const };
  if (input.employeeRole !== input.requiredRole) return { valid: false as const, code: "ROLE_MISMATCH" as const };
  return { valid: true as const, code: "DEMO_IDENTITY_MATCH" as const };
}

export function acceptDemoWorkItem(item: WorkItem, persona: { employeeId: string; role: string; origin: "DEMO_PERSONA" }) {
  const validation = validatePreviewAssignment({ employeeId: persona.employeeId, employeeRole: persona.role, requiredRole: item.role });
  return { accepted: validation.valid, code: validation.code, employeeId: validation.valid ? persona.employeeId : item.employeeId, writes: 0 as const, runtimeAcceptanceCreated: false as const };
}

export function applyForecastWithoutDeadlineRewrite(item: WorkItem, forecastAt: string | null, estimateMinutes: number | null) {
  return { ...item, forecastAt, estimateMinutes, committedDeadline: item.committedDeadline, lockedBookingChanged: false as const };
}

export function serializePublicWorkplanProjection(items: Array<Record<string, unknown>>) {
  return items.flatMap((item) => item.publicationEvidence === "VERIFIED"
    && item.visibility === "ALLOWLISTED"
    && item.origin !== "CO_S5_PROPOSAL"
    && item.origin !== "DEMO_CP070"
    && item.origin !== "TRAINING_DRAFT"
      ? [{ materialId: String(item.materialId ?? ""), materialVersion: String(item.materialVersion ?? ""), title: String(item.title ?? ""), publicUrl: String(item.publicUrl ?? "") }]
      : []);
}
