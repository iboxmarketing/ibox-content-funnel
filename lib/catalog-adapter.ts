export const CATALOG_ADAPTER_VERSION = "co-s2.catalog-adapter.v1";

export type RawRecord = Record<string, string>;

export type CatalogSourceRow = {
  sourceTab: string;
  sourceRow: number;
  sourceId: string;
  raw: RawRecord;
};

export type CatalogTabSnapshot = {
  title: string;
  sheetId: number | null;
  rowCount: number | null;
  columnCount: number | null;
  headers: string[];
  rows: CatalogSourceRow[];
};

export type DiagnosticSeverity = "error" | "warning" | "info";
export type DiagnosticCategory =
  | "STRUCTURAL_ERROR"
  | "MAPPING_GAP"
  | "CONFIG_RELEASE_BLOCK"
  | "OPTIONAL_NOT_SELECTED"
  | "RUNTIME_UNAVAILABLE"
  | "SAFETY_MODE";

export type CatalogDiagnostic = {
  code: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  entityType: string;
  entityId: string;
  field: string;
  sourceRange: string;
  reasonUz: string;
  nextStepUz: string;
};

export type DomainStatus =
  | "PLAN_APPROVED"
  | "PROPOSED"
  | "ITEM_PROPOSED"
  | "DRAFT"
  | "RELEASED"
  | "CONFIGURED"
  | "CONFIRMED"
  | "UNKNOWN";

export type CatalogProvenance = {
  sourceTab: string;
  sourceRow: number;
  sourceId: string;
  sourceRange: string;
  raw: RawRecord;
};

export type CatalogPackagePlan = {
  packagePlanId: string;
  topicUz: string;
  primaryArea: string;
  clusterId: string;
  mainNodeId: string;
  packageObjectiveUz: string;
  suggestedOrder: number | null;
  planningStatusRaw: string;
  planningStatus: DomainStatus;
  provenance: CatalogProvenance;
};

export type CatalogPublicationIntent = {
  publicationIntentId: string;
  materialRefId: string;
  channelAccountId: string;
  occurrence: number;
  state: "INTENT_ONLY";
  runtimePublicationEvidence: "UNKNOWN";
};

export type CtaContract = {
  state: "MAPPING_REQUIRED" | "VALID" | "INVALID";
  primaryType: string | null;
  nativeAction: boolean;
  destinationRef: string | null;
  variantId: string | null;
};

export type SourceRelation = {
  sourceEntityId: string | null;
  sourceMaterialVersion: string | null;
  status: "UNKNOWN_VERSION" | "NOT_PROVIDED" | "REFERENCE_ONLY";
};

export type CatalogPackageItem = {
  packageItemId: string;
  packagePlanId: string;
  itemOrder: number | null;
  workflowId: string;
  formatCode: string;
  workingTitleUz: string;
  sourceNodeId: string;
  sourceProductionId: string;
  sourcePackageItemId: string;
  language: string;
  quantity: number | null;
  required: boolean | null;
  approvalStatusRaw: string;
  approvalStatus: DomainStatus;
  active: boolean | null;
  runtimeItemId: string;
  materialRefId: string;
  materialRefKind: "RUNTIME_REFERENCE" | "PREVIEW_SOURCE_REFERENCE";
  materialIdentityVerification: "UNVERIFIED" | "PREVIEW_ONLY";
  ownerEmployeeId: string;
  identityState: "UNASSIGNED" | "IDENTITY_UNVERIFIED";
  cta: CtaContract;
  sourceRelation: SourceRelation;
  publicationIntents: CatalogPublicationIntent[];
  provenance: CatalogProvenance;
};

export type CatalogAngle = {
  angleId: string;
  angleKind: "EXPLICIT_DEMO" | "UNMAPPED_LEGACY_NODE";
  canonicalProblemIds: string[];
  clusterId: string;
  questionUz: string;
  outcomeUz: string;
  boundaryUz: string;
  candidateNodeIds: string[];
  learningAfterAngleIds: string[];
  relatedAngleIds: string[];
  materialRefIds: string[];
  provenance: CatalogProvenance | null;
};

export type WorkflowPreview = {
  workflowId: string;
  packageItemIds: string[];
  executable: false;
  releaseBlocked: boolean;
  steps: Array<{
    stepId: string;
    stepOrder: number | null;
    taskTemplateId: string | null;
    dependencyStepIds: string[];
    isMilestone: boolean | null;
    conditionRaw: string;
    conditionState: "PENDING" | "FALSE" | "UNKNOWN";
    statusRaw: string;
    status: DomainStatus;
    ownerRole: string | null;
    assignmentRuleId: string | null;
    estimateMinutes: number | null;
    templateVersion: string | null;
    templateStatusRaw: string | null;
  }>;
  manifestEntryIds: string[];
};

export type ConfigManifestEntry = {
  manifestEntryId: string;
  kind: "TASK_TEMPLATE" | "CHECKLIST" | "WORKFLOW_STEP" | "APPROVAL_POLICY" | "ASSIGNMENT_RULE" | "NOTIFICATION_RULE" | "DATA_CONTRACT";
  sourceId: string;
  version: string | null;
  statusRaw: string;
  status: DomainStatus;
  provenance: CatalogProvenance;
};

export type CatalogPreview = {
  adapterVersion: string;
  safetyMode: "CO_S2_PREVIEW_ONLY";
  sourceSnapshot: {
    spreadsheetId: string;
    capturedAt: string;
    hash: string;
    tabs: Array<{ title: string; sheetId: number | null; headers: string[]; rowCount: number; contentHash: string }>;
  };
  configManifest: {
    hash: string;
    entries: ConfigManifestEntry[];
  };
  packagePlans: CatalogPackagePlan[];
  packageItems: CatalogPackageItem[];
  angles: CatalogAngle[];
  workflowPreviews: WorkflowPreview[];
  diagnostics: CatalogDiagnostic[];
  metrics: {
    approvedPackagePlans: number;
    proposedPackagePlans: number;
    activeSelectedMaterials: number;
    publicationIntentCount: number;
    runtimeTaskCandidateCount: 0;
    backendRealTaskCount: number | null;
    backendState: "UNAVAILABLE" | "AVAILABLE";
  };
};

export type CatalogAdapterInput = {
  spreadsheetId: string;
  capturedAt: string;
  tabs: CatalogTabSnapshot[];
  backendProjection?: { available: boolean; realTaskCount?: number | null };
  overlayAngles?: CatalogAngle[];
};

const PRIMARY_TABS = [
  "13_CONTENT_NODES",
  "33_TOPIC_PACKAGE_PLAN",
  "35_TOPIC_PACKAGE_ITEMS",
  "23_TASK_TEMPLATES",
  "24_CHECKLIST_TEMPLATES",
  "25_WORKFLOW_STEPS",
  "26_APPROVAL_POLICIES",
  "27_ASSIGNMENT_RULES",
  "28_NOTIFICATION_RULES",
  "29_SHEET_DB_CONTRACT",
] as const;

const OCCUPATIONAL_ROLES = new Set(["head", "content marketer", "operator / montajer", "digital marketer", "seo"]);
const RESOLVER_ROLES = new Set(["previous_performer", "by_format", "by_assignment"]);

function normalizeToken(value: string) {
  return value.toLocaleLowerCase("uz").replace(/[’‘`ʻʼ]/g, "'").replace(/\s+/g, " ").trim();
}

function readRaw(row: CatalogSourceRow, key: string) {
  return row.raw[key] ?? "";
}

function splitList(value: string) {
  return value.split(/[|,;\n]+/).map((part) => part.trim()).filter(Boolean);
}

export function parseSheetBoolean(value: string): boolean | null {
  const normalized = normalizeToken(value);
  if (["true", "1", "yes", "ha", "active"].includes(normalized)) return true;
  if (["false", "0", "no", "yo'q", "yo‘q", "inactive"].includes(normalized)) return false;
  return null;
}

export function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeDomainStatus(domain: "package" | "item" | "template" | "policy" | "contract", raw: string): DomainStatus {
  const value = normalizeToken(raw);
  const aliases: Record<string, Partial<Record<typeof domain, DomainStatus>>> = {
    "tasdiqlangan reja": { package: "PLAN_APPROVED" },
    "plan approved": { package: "PLAN_APPROVED" },
    "taklif": { package: "PROPOSED", item: "ITEM_PROPOSED" },
    "proposed": { package: "PROPOSED", item: "ITEM_PROPOSED" },
    "draft": { template: "DRAFT" },
    "released": { template: "RELEASED" },
    "active": { template: "RELEASED" },
    "configured": { policy: "CONFIGURED" },
    "confirmed": { contract: "CONFIRMED" },
  };
  return aliases[value]?.[domain] ?? "UNKNOWN";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function stableHash(value: unknown) {
  const text = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function provenance(row: CatalogSourceRow): CatalogProvenance {
  return { ...row, sourceRange: `${row.sourceTab}!${row.sourceRow}:${row.sourceRow}` };
}

function diagnostic(row: CatalogSourceRow | null, values: Omit<CatalogDiagnostic, "sourceRange">): CatalogDiagnostic {
  return { ...values, sourceRange: row ? `${row.sourceTab}!${row.sourceRow}:${row.sourceRow}` : "adapter" };
}

function collectManifest(tabs: Map<string, CatalogTabSnapshot>) {
  const definitions = [
    ["23_TASK_TEMPLATES", "TASK_TEMPLATE", "Task_Template_ID", "Template_Version", "Template_Status", "template"],
    ["24_CHECKLIST_TEMPLATES", "CHECKLIST", "Checklist_Template_ID", "Template_Version", "", "template"],
    ["25_WORKFLOW_STEPS", "WORKFLOW_STEP", "Step_ID", "Template_Version", "Status", "template"],
    ["26_APPROVAL_POLICIES", "APPROVAL_POLICY", "Approval_Policy_ID", "Policy_Version", "Policy_Status", "policy"],
    ["27_ASSIGNMENT_RULES", "ASSIGNMENT_RULE", "Assignment_Rule_ID", "Rule_Version", "Status", "policy"],
    ["28_NOTIFICATION_RULES", "NOTIFICATION_RULE", "Rule_ID", "Rule_Version", "Status", "policy"],
    ["29_SHEET_DB_CONTRACT", "DATA_CONTRACT", "Contract_ID", "Contract_Version", "Status", "contract"],
  ] as const;
  const entries: ConfigManifestEntry[] = [];
  for (const [tab, kind, idKey, versionKey, statusKey, domain] of definitions) {
    for (const row of tabs.get(tab)?.rows ?? []) {
      const sourceId = readRaw(row, idKey);
      if (!sourceId) continue;
      const statusRaw = statusKey ? readRaw(row, statusKey) : "";
      entries.push({
        manifestEntryId: `${kind}:${sourceId}`,
        kind,
        sourceId,
        version: versionKey && readRaw(row, versionKey) ? readRaw(row, versionKey) : null,
        statusRaw,
        status: normalizeDomainStatus(domain, statusRaw),
        provenance: provenance(row),
      });
    }
  }
  entries.sort((a, b) => a.manifestEntryId.localeCompare(b.manifestEntryId));
  return { entries, hash: stableHash(entries.map(({ provenance: source, ...entry }) => ({ ...entry, raw: source.raw }))) };
}

function publicationIntents(item: CatalogPackageItem, channelValue: string): CatalogPublicationIntent[] {
  const occurrences = new Map<string, number>();
  return splitList(channelValue).map((channelAccountId) => {
    const occurrence = (occurrences.get(channelAccountId) ?? 0) + 1;
    occurrences.set(channelAccountId, occurrence);
    return {
      publicationIntentId: `pub:${item.packageItemId}:${channelAccountId}:${occurrence}`,
      materialRefId: item.materialRefId,
      channelAccountId,
      occurrence,
      state: "INTENT_ONLY" as const,
      runtimePublicationEvidence: "UNKNOWN" as const,
    };
  });
}

function buildWorkflowPreviews(
  tabs: Map<string, CatalogTabSnapshot>,
  items: CatalogPackageItem[],
  manifest: { entries: ConfigManifestEntry[] },
  diagnostics: CatalogDiagnostic[],
): WorkflowPreview[] {
  const templateRows = new Map((tabs.get("23_TASK_TEMPLATES")?.rows ?? []).map((row) => [readRaw(row, "Task_Template_ID"), row]));
  const assignmentRows = new Map((tabs.get("27_ASSIGNMENT_RULES")?.rows ?? []).map((row) => [readRaw(row, "Assignment_Rule_ID"), row]));
  const manifestById = new Map(manifest.entries.map((entry) => [entry.manifestEntryId, entry]));
  const workflowIds = Array.from(new Set(items.map((item) => item.workflowId).filter(Boolean))).sort();
  return workflowIds.map((workflowId) => {
    const rows = (tabs.get("25_WORKFLOW_STEPS")?.rows ?? []).filter((row) => readRaw(row, "Workflow_ID") === workflowId);
    const stepIds = new Set(rows.map((row) => readRaw(row, "Step_ID")));
    const manifestEntryIds = new Set<string>();
    let releaseBlocked = false;
    const steps = rows.map((row) => {
      const stepId = readRaw(row, "Step_ID");
      const templateId = readRaw(row, "Task_Template_ID");
      const isMilestone = parseSheetBoolean(readRaw(row, "Is_Milestone"));
      const template = templateRows.get(templateId);
      const stepStatusRaw = readRaw(row, "Status");
      const stepStatus = normalizeDomainStatus("template", stepStatusRaw);
      if (stepStatus !== "RELEASED") releaseBlocked = true;
      manifestEntryIds.add(`WORKFLOW_STEP:${stepId}`);
      if (templateId) {
        manifestEntryIds.add(`TASK_TEMPLATE:${templateId}`);
        if (!template) diagnostics.push(diagnostic(row, {
          code: "DANGLING_TASK_TEMPLATE", category: "STRUCTURAL_ERROR", severity: "error", entityType: "workflow_step", entityId: stepId,
          field: "Task_Template_ID", reasonUz: `${templateId} shabloni topilmadi.`, nextStepUz: "23-jadvaldagi aniq IDni tekshiring.",
        }));
      } else if (isMilestone !== true) {
        diagnostics.push(diagnostic(row, {
          code: "TASK_TEMPLATE_REQUIRED", category: "STRUCTURAL_ERROR", severity: "error", entityType: "workflow_step", entityId: stepId,
          field: "Task_Template_ID", reasonUz: "Milestone bo‘lmagan qadamda task shabloni yo‘q.", nextStepUz: "Task_Template_ID kiriting yoki Is_Milestone=TRUE qiling.",
        }));
      }
      for (const dependency of splitList(readRaw(row, "Dependency_Step_IDs"))) {
        if (!stepIds.has(dependency)) diagnostics.push(diagnostic(row, {
          code: "DANGLING_STEP_DEPENDENCY", category: "STRUCTURAL_ERROR", severity: "error", entityType: "workflow_step", entityId: stepId,
          field: "Dependency_Step_IDs", reasonUz: `${dependency} dependency shu workflowda topilmadi.`, nextStepUz: "Step ID yoki workflow membershipini tekshiring.",
        }));
      }
      const assignmentRuleId = template ? readRaw(template, "Assignment_Rule_ID") : "";
      const ownerRole = template ? readRaw(template, "Owner_Role") : "";
      if (assignmentRuleId) manifestEntryIds.add(`ASSIGNMENT_RULE:${assignmentRuleId}`);
      const assignment = assignmentRows.get(assignmentRuleId);
      if (assignmentRuleId && !assignment) diagnostics.push(diagnostic(template ?? row, {
        code: "ASSIGNMENT_RULE_MISSING", category: "STRUCTURAL_ERROR", severity: "error", entityType: "task_template", entityId: templateId,
        field: "Assignment_Rule_ID", reasonUz: `${assignmentRuleId} assignment qoidasi topilmadi.`, nextStepUz: "27-jadvaldagi reference’ni tekshiring.",
      }));
      const roleToken = normalizeToken(ownerRole);
      if (ownerRole && !OCCUPATIONAL_ROLES.has(roleToken)) diagnostics.push(diagnostic(template ?? row, {
        code: /smm|developer/.test(roleToken) ? "LEGACY_ROLE_NOT_ALLOWED" : "ROLE_MAPPING_REQUIRED",
        category: "MAPPING_GAP", severity: "warning", entityType: "task_template", entityId: templateId,
        field: "Owner_Role", reasonUz: `${ownerRole} yangi content assignee roli sifatida ishlatilmaydi.`, nextStepUz: "27dagi amaldagi kasbiy rol yoki resolver qoidasi bilan aniq mapping bering.",
      }));
      const eligibleRole = assignment ? normalizeToken(readRaw(assignment, "Eligible_Role")) : "";
      if (eligibleRole && !OCCUPATIONAL_ROLES.has(eligibleRole) && !RESOLVER_ROLES.has(eligibleRole)) diagnostics.push(diagnostic(assignment ?? row, {
        code: "ASSIGNMENT_ELIGIBLE_ROLE_UNKNOWN", category: "MAPPING_GAP", severity: "warning", entityType: "assignment_rule", entityId: assignmentRuleId,
        field: "Eligible_Role", reasonUz: "Kasbiy rol yoki tanilgan resolver turi emas.", nextStepUz: "Role va resolver tushunchalarini alohida mapping qiling.",
      }));
      const templateStatusRaw = template ? readRaw(template, "Template_Status") : null;
      const templateStatus = templateStatusRaw === null ? "UNKNOWN" : normalizeDomainStatus("template", templateStatusRaw);
      if (templateId && templateStatus !== "RELEASED") releaseBlocked = true;
      return {
        stepId,
        stepOrder: parseOptionalNumber(readRaw(row, "Step_Order")),
        taskTemplateId: templateId || null,
        dependencyStepIds: splitList(readRaw(row, "Dependency_Step_IDs")),
        isMilestone,
        conditionRaw: readRaw(row, "Activation_Condition"),
        conditionState: readRaw(row, "Activation_Condition") ? "PENDING" as const : "UNKNOWN" as const,
        statusRaw: stepStatusRaw,
        status: stepStatus,
        ownerRole: ownerRole || null,
        assignmentRuleId: assignmentRuleId || null,
        estimateMinutes: template ? parseOptionalNumber(readRaw(template, "Estimate_Minutes")) : null,
        templateVersion: template && readRaw(template, "Template_Version") ? readRaw(template, "Template_Version") : null,
        templateStatusRaw,
      };
    }).sort((a, b) => (a.stepOrder ?? Number.MAX_SAFE_INTEGER) - (b.stepOrder ?? Number.MAX_SAFE_INTEGER) || a.stepId.localeCompare(b.stepId));
    for (const entryId of [...manifestEntryIds]) if (!manifestById.has(entryId)) manifestEntryIds.delete(entryId);
    return {
      workflowId,
      packageItemIds: items.filter((item) => item.workflowId === workflowId).map((item) => item.packageItemId),
      executable: false,
      releaseBlocked,
      steps,
      manifestEntryIds: [...manifestEntryIds].sort(),
    };
  });
}

function validateDuplicateIds(tab: CatalogTabSnapshot | undefined, key: string, diagnostics: CatalogDiagnostic[]) {
  const seen = new Map<string, CatalogSourceRow>();
  for (const row of tab?.rows ?? []) {
    const id = readRaw(row, key);
    if (!id) continue;
    const prior = seen.get(id);
    if (prior) diagnostics.push(diagnostic(row, {
      code: "DUPLICATE_ID", category: "STRUCTURAL_ERROR", severity: "error", entityType: tab?.title ?? "row", entityId: id,
      field: key, reasonUz: `${id} takrorlangan; birinchi yozuv ${prior.sourceTab}!${prior.sourceRow}.`, nextStepUz: "IDni Sheet egasi bilan aniqlashtiring; row tartibidan yangi ID yasamang.",
    }));
    else seen.set(id, row);
  }
}

export function buildCatalogPreview(input: CatalogAdapterInput): CatalogPreview {
  const tabs = new Map(input.tabs.map((tab) => [tab.title, tab]));
  const diagnostics: CatalogDiagnostic[] = [];
  for (const title of PRIMARY_TABS) {
    const tab = tabs.get(title);
    if (!tab) diagnostics.push(diagnostic(null, {
      code: "SOURCE_TAB_MISSING", category: "STRUCTURAL_ERROR", severity: "error", entityType: "source_tab", entityId: title,
      field: "title", reasonUz: `${title} metadata’da topilmadi.`, nextStepUz: "Tab nomini taxmin qilmasdan joriy metadata bilan tekshiring.",
    }));
    else if (!tab.headers.length) diagnostics.push(diagnostic(null, {
      code: "HEADER_MISSING", category: "STRUCTURAL_ERROR", severity: "error", entityType: "source_tab", entityId: title,
      field: "headers", reasonUz: `${title} header qatori o‘qilmadi.`, nextStepUz: "Header diapazoni va required ID ustunini tekshiring.",
    }));
  }
  validateDuplicateIds(tabs.get("33_TOPIC_PACKAGE_PLAN"), "Package_Plan_ID", diagnostics);
  validateDuplicateIds(tabs.get("35_TOPIC_PACKAGE_ITEMS"), "Package_Item_ID", diagnostics);
  validateDuplicateIds(tabs.get("13_CONTENT_NODES"), "Node_ID", diagnostics);
  validateDuplicateIds(tabs.get("23_TASK_TEMPLATES"), "Task_Template_ID", diagnostics);
  validateDuplicateIds(tabs.get("25_WORKFLOW_STEPS"), "Step_ID", diagnostics);

  const packagePlans: CatalogPackagePlan[] = (tabs.get("33_TOPIC_PACKAGE_PLAN")?.rows ?? []).flatMap((row) => {
    const packagePlanId = readRaw(row, "Package_Plan_ID");
    if (!packagePlanId) return [];
    const planningStatusRaw = readRaw(row, "Planning_Status");
    const planningStatus = normalizeDomainStatus("package", planningStatusRaw);
    if (planningStatus === "UNKNOWN") diagnostics.push(diagnostic(row, {
      code: "PACKAGE_STATUS_UNKNOWN", category: "MAPPING_GAP", severity: "warning", entityType: "package_plan", entityId: packagePlanId,
      field: "Planning_Status", reasonUz: `“${planningStatusRaw || "bo‘sh"}” paket statusi alias registry’da yo‘q.`, nextStepUz: "Raw qiymatni saqlagan holda explicit domen aliasini kelishing.",
    }));
    return [{
      packagePlanId,
      topicUz: readRaw(row, "Topic_UZ"),
      primaryArea: readRaw(row, "Primary_Area"),
      clusterId: readRaw(row, "Cluster_ID"),
      mainNodeId: readRaw(row, "Main_Node_ID"),
      packageObjectiveUz: readRaw(row, "Package_Objective_UZ"),
      suggestedOrder: parseOptionalNumber(readRaw(row, "Suggested_Order")),
      planningStatusRaw,
      planningStatus,
      provenance: provenance(row),
    }];
  });
  const packageIds = new Set(packagePlans.map((item) => item.packagePlanId));

  const packageItems: CatalogPackageItem[] = (tabs.get("35_TOPIC_PACKAGE_ITEMS")?.rows ?? []).flatMap((row) => {
    const packageItemId = readRaw(row, "Package_Item_ID");
    if (!packageItemId) return [];
    const packagePlanId = readRaw(row, "Package_Plan_ID");
    const active = parseSheetBoolean(readRaw(row, "Active"));
    const required = parseSheetBoolean(readRaw(row, "Required"));
    const approvalStatusRaw = readRaw(row, "Approval_Status");
    const approvalStatus = normalizeDomainStatus("item", approvalStatusRaw);
    const runtimeItemId = readRaw(row, "Runtime_Item_ID");
    const materialRefId = runtimeItemId ? `runtime:${runtimeItemId}` : `preview:${packageItemId}`;
    const item: CatalogPackageItem = {
      packageItemId,
      packagePlanId,
      itemOrder: parseOptionalNumber(readRaw(row, "Item_Order")),
      workflowId: readRaw(row, "Workflow_ID"),
      formatCode: readRaw(row, "Format_Code"),
      workingTitleUz: readRaw(row, "Working_Title_UZ"),
      sourceNodeId: readRaw(row, "Source_Node_ID"),
      sourceProductionId: readRaw(row, "Source_Production_ID"),
      sourcePackageItemId: readRaw(row, "Source_Package_Item_ID"),
      language: readRaw(row, "Language"),
      quantity: parseOptionalNumber(readRaw(row, "Quantity")),
      required,
      approvalStatusRaw,
      approvalStatus,
      active,
      runtimeItemId,
      materialRefId,
      materialRefKind: runtimeItemId ? "RUNTIME_REFERENCE" : "PREVIEW_SOURCE_REFERENCE",
      materialIdentityVerification: runtimeItemId ? "UNVERIFIED" : "PREVIEW_ONLY",
      ownerEmployeeId: readRaw(row, "Owner_Employee_ID"),
      identityState: readRaw(row, "Owner_Employee_ID") ? "IDENTITY_UNVERIFIED" : "UNASSIGNED",
      cta: { state: "MAPPING_REQUIRED", primaryType: null, nativeAction: false, destinationRef: null, variantId: null },
      sourceRelation: {
        sourceEntityId: readRaw(row, "Source_Package_Item_ID") || readRaw(row, "Source_Node_ID") || null,
        sourceMaterialVersion: null,
        status: readRaw(row, "Source_Package_Item_ID") || readRaw(row, "Source_Node_ID") ? "UNKNOWN_VERSION" : "NOT_PROVIDED",
      },
      publicationIntents: [],
      provenance: provenance(row),
    };
    item.publicationIntents = publicationIntents(item, readRaw(row, "Channel_Account_IDs"));
    if (!packageIds.has(packagePlanId)) diagnostics.push(diagnostic(row, {
      code: "DANGLING_PACKAGE_PLAN", category: "STRUCTURAL_ERROR", severity: "error", entityType: "package_item", entityId: packageItemId,
      field: "Package_Plan_ID", reasonUz: `${packagePlanId || "bo‘sh ID"} paket rejasi topilmadi.`, nextStepUz: "33dagi Package_Plan_ID reference’ini tekshiring.",
    }));
    if (active === null) diagnostics.push(diagnostic(row, {
      code: "ACTIVE_BOOLEAN_UNKNOWN", category: "STRUCTURAL_ERROR", severity: "error", entityType: "package_item", entityId: packageItemId,
      field: "Active", reasonUz: `“${readRaw(row, "Active") || "bo‘sh"}” boolean sifatida tanilmadi.`, nextStepUz: "TRUE yoki FALSE typed qiymat kiriting; noma’lum qiymat active emas.",
    }));
    if (required === null) diagnostics.push(diagnostic(row, {
      code: "REQUIRED_BOOLEAN_UNKNOWN", category: "STRUCTURAL_ERROR", severity: "error", entityType: "package_item", entityId: packageItemId,
      field: "Required", reasonUz: `“${readRaw(row, "Required") || "bo‘sh"}” boolean sifatida tanilmadi.`, nextStepUz: "TRUE yoki FALSE typed qiymat kiriting.",
    }));
    if (active !== true) diagnostics.push(diagnostic(row, {
      code: "ITEM_NOT_SELECTED", category: "OPTIONAL_NOT_SELECTED", severity: "info", entityType: "package_item", entityId: packageItemId,
      field: "Active", reasonUz: "Material taklifi faol/tanlangan emas; katalogda ko‘rinishi mumkin, real taskga kirmaydi.", nextStepUz: "Tanlov keyingi material selector bosqichida aniq tasdiqlanadi.",
    }));
    if (!runtimeItemId) diagnostics.push(diagnostic(row, {
      code: "RUNTIME_MATERIAL_NOT_LINKED", category: "MAPPING_GAP", severity: "info", entityType: "package_item", entityId: packageItemId,
      field: "Runtime_Item_ID", reasonUz: "TPI ID umumiy runtime material identity sifatida qabul qilinmadi.", nextStepUz: "Runtime material yaratilsa uning mustaqil ID va membership bog‘lanishini saqlang.",
    }));
    if (item.sourceRelation.status === "UNKNOWN_VERSION") diagnostics.push(diagnostic(row, {
      code: "SOURCE_VERSION_UNKNOWN", category: "MAPPING_GAP", severity: "warning", entityType: "package_item", entityId: packageItemId,
      field: "Source_Package_Item_ID", reasonUz: "Source reference bor, ammo material versiyasi ko‘rsatilmagan.", nextStepUz: "Source entity va source versionni alohida maydonlarda kelishing.",
    }));
    diagnostics.push(diagnostic(row, {
      code: "CTA_MAPPING_REQUIRED", category: "MAPPING_GAP", severity: "info", entityType: "package_item", entityId: packageItemId,
      field: "Primary_CTA", reasonUz: "Joriy 35 headerida material/test-versiya primary CTA kontrakti yo‘q.", nextStepUz: "CO-S3 schema-diffda CTA turi, variant va destination reference’ini ajrating.",
    }));
    return [item];
  });

  const contentNodes = new Map((tabs.get("13_CONTENT_NODES")?.rows ?? []).map((row) => [readRaw(row, "Node_ID"), row]));
  const referencedNodeIds = new Set([...packagePlans.map((item) => item.mainNodeId), ...packageItems.map((item) => item.sourceNodeId)].filter(Boolean));
  const angles: CatalogAngle[] = [...referencedNodeIds].map((nodeId) => {
    const row = contentNodes.get(nodeId);
    if (!row) {
      diagnostics.push(diagnostic(null, {
        code: "CONTENT_NODE_MISSING", category: "STRUCTURAL_ERROR", severity: "error", entityType: "legacy_node", entityId: nodeId,
        field: "Node_ID", reasonUz: `${nodeId} 13_CONTENT_NODES ichida topilmadi.`, nextStepUz: "Node reference’ini aniq ID bilan tekshiring.",
      }));
      return { angleId: `legacy:${nodeId}`, angleKind: "UNMAPPED_LEGACY_NODE" as const, canonicalProblemIds: [], clusterId: "", questionUz: "", outcomeUz: "", boundaryUz: "", candidateNodeIds: [nodeId], learningAfterAngleIds: [], relatedAngleIds: [], materialRefIds: packageItems.filter((item) => item.sourceNodeId === nodeId).map((item) => item.materialRefId), provenance: null };
    }
    diagnostics.push(diagnostic(row, {
      code: "ANGLE_MAPPING_REQUIRED", category: "MAPPING_GAP", severity: "warning", entityType: "legacy_node", entityId: nodeId,
      field: "Angle_ID", reasonUz: "Har Node_ID avtomatik mustaqil angle emas; explicit angle mappingi yo‘q.", nextStepUz: "Mustaqil savol, natija va chegara tasdiqlangach barqaror Angle_ID bering.",
    }));
    return {
      angleId: `legacy:${nodeId}`,
      angleKind: "UNMAPPED_LEGACY_NODE" as const,
      canonicalProblemIds: splitList(readRaw(row, "Canonical_Problem_IDs")),
      clusterId: readRaw(row, "Cluster_ID"),
      questionUz: readRaw(row, "Main_Question"),
      outcomeUz: "",
      boundaryUz: "",
      candidateNodeIds: [nodeId],
      learningAfterAngleIds: [],
      relatedAngleIds: splitList(readRaw(row, "Related_Nodes")).map((id) => `legacy:${id}`),
      materialRefIds: packageItems.filter((item) => item.sourceNodeId === nodeId).map((item) => item.materialRefId),
      provenance: provenance(row),
    };
  });
  if (input.overlayAngles?.length) angles.push(...input.overlayAngles);

  const configManifest = collectManifest(tabs);
  const workflowPreviews = buildWorkflowPreviews(tabs, packageItems, configManifest, diagnostics);
  for (const preview of workflowPreviews.filter((item) => item.releaseBlocked)) diagnostics.push(diagnostic(null, {
    code: "WORKFLOW_RELEASE_BLOCKED", category: "CONFIG_RELEASE_BLOCK", severity: "warning", entityType: "workflow_preview", entityId: preview.workflowId,
    field: "Status", reasonUz: "Workflow yoki uning task shabloni Draft/release qilinmagan.", nextStepUz: "Katalog previewni ko‘ring, lekin runtime apply qilmang.",
  }));
  diagnostics.push(diagnostic(null, {
    code: "CO_S2_PREVIEW_ONLY", category: "SAFETY_MODE", severity: "info", entityType: "adapter", entityId: CATALOG_ADAPTER_VERSION,
    field: "execution", reasonUz: "CO-S2 server tomonda preview-only; task/migration/notification/schedule/publish/ads writerlari ulanmagan.", nextStepUz: "Real apply faqat keyingi alohida ruxsat va backend integratsiyasidan keyin.",
  }));
  const backendAvailable = input.backendProjection?.available === true;
  if (!backendAvailable) diagnostics.push(diagnostic(null, {
    code: "RUNTIME_BACKEND_UNAVAILABLE", category: "RUNTIME_UNAVAILABLE", severity: "warning", entityType: "runtime", entityId: "task-backend",
    field: "realTaskCount", reasonUz: "Haqiqiy task backend projectioni ulanmagan; real tasklar soni 0 deb olinmadi.", nextStepUz: "Verified backend read model kelganda noma’lum holatni real projection bilan almashtiring.",
  }));

  const snapshotTabs = input.tabs.map((tab) => {
    const canonicalRows = [...tab.rows].sort((a, b) => a.sourceId.localeCompare(b.sourceId) || stableHash(a.raw).localeCompare(stableHash(b.raw)));
    return { title: tab.title, sheetId: tab.sheetId, headers: tab.headers, rowCount: tab.rows.length, contentHash: stableHash(canonicalRows.map((row) => ({ sourceId: row.sourceId, raw: row.raw }))) };
  }).sort((a, b) => a.title.localeCompare(b.title));
  const sourceSnapshot = {
    spreadsheetId: input.spreadsheetId,
    capturedAt: input.capturedAt,
    hash: stableHash(snapshotTabs.map(({ title, sheetId, headers, rowCount, contentHash }) => ({ title, sheetId, headers, rowCount, contentHash }))),
    tabs: snapshotTabs,
  };
  const publicationIntentCount = packageItems.reduce((sum, item) => sum + item.publicationIntents.length, 0);
  return {
    adapterVersion: CATALOG_ADAPTER_VERSION,
    safetyMode: "CO_S2_PREVIEW_ONLY",
    sourceSnapshot,
    configManifest,
    packagePlans,
    packageItems,
    angles,
    workflowPreviews,
    diagnostics,
    metrics: {
      approvedPackagePlans: packagePlans.filter((item) => item.planningStatus === "PLAN_APPROVED").length,
      proposedPackagePlans: packagePlans.filter((item) => item.planningStatus === "PROPOSED").length,
      activeSelectedMaterials: packageItems.filter((item) => item.active === true).length,
      publicationIntentCount,
      runtimeTaskCandidateCount: 0,
      backendRealTaskCount: backendAvailable ? input.backendProjection?.realTaskCount ?? null : null,
      backendState: backendAvailable ? "AVAILABLE" : "UNAVAILABLE",
    },
  };
}

export type PublicCatalogMaterial = {
  materialId: string;
  title: string;
  publicUrl: string;
  language: string;
  publishedAt: string;
};

export function serializePublicCatalog(input: Array<{
  materialId: string;
  title: string;
  publicUrl: string;
  language: string;
  publishedAt: string;
  publicationEvidence: "VERIFIED" | "UNKNOWN";
  visibility: "ALLOWLISTED" | "PRIVATE";
  employeeId?: string;
  telegramId?: string;
  taskNotes?: string;
  cost?: string;
  draftTitle?: string;
}>): PublicCatalogMaterial[] {
  return input.flatMap((item) => item.publicationEvidence === "VERIFIED" && item.visibility === "ALLOWLISTED"
    ? [{ materialId: item.materialId, title: item.title, publicUrl: item.publicUrl, language: item.language, publishedAt: item.publishedAt }]
    : []);
}

export function validatePrimaryCtas(ctas: CtaContract[]) {
  const primaries = ctas.filter((cta) => cta.state === "VALID");
  if (primaries.length > 1) return { valid: false, code: "MULTIPLE_PRIMARY_CTA" } as const;
  if (!primaries.length) return { valid: false, code: "PRIMARY_CTA_MISSING" } as const;
  const cta = primaries[0];
  if (!cta.nativeAction && !cta.destinationRef) return { valid: false, code: "DESTINATION_REQUIRED" } as const;
  return { valid: true, code: "OK" } as const;
}

export function validateContentAssignment(input: {
  requiredRole: string;
  candidateEmployeeId: string | null;
  candidateRole: string | null;
  recordType?: string | null;
  authorEmployeeIds?: string[];
  independentReviewRequired?: boolean;
}) {
  const required = normalizeToken(input.requiredRole);
  const candidateRole = normalizeToken(input.candidateRole ?? "");
  if (!input.candidateEmployeeId) return { allowed: false, code: "IDENTITY_UNVERIFIED" } as const;
  if (normalizeToken(input.recordType ?? "") === "role_placeholder" || input.candidateEmployeeId.startsWith("ROLE-")) return { allowed: false, code: "ROLE_PLACEHOLDER_NOT_IDENTITY" } as const;
  if (/^(smm manager|developer)$/.test(required) || /^(smm manager|developer)$/.test(candidateRole)) return { allowed: false, code: "LEGACY_ROLE_NOT_ALLOWED" } as const;
  if (!OCCUPATIONAL_ROLES.has(required) || required !== candidateRole) return { allowed: false, code: "ROLE_MISMATCH" } as const;
  if (input.independentReviewRequired && (input.authorEmployeeIds ?? []).includes(input.candidateEmployeeId)) return { allowed: false, code: "REVIEWER_IS_AUTHOR" } as const;
  return { allowed: true, code: "OK" } as const;
}

export function applyYoutubeDecision<T extends { formatCode: string }>(materials: T[], decision: "PENDING" | "YES" | "NO") {
  return materials.map((material) => ({
    ...material,
    youtubeLongPathState: material.formatCode === "LONG_VIDEO"
      ? decision === "NO" ? "NOT_APPLICABLE" : decision === "YES" ? "AVAILABLE_NOT_SELECTED" : "PENDING"
      : "INDEPENDENT",
  }));
}

export function evaluateSourceReference(input: {
  approvedSourceVersion: string | null;
  availableVersions: Array<{ version: string; archived: boolean; replacementVersion: string | null }>;
}) {
  if (!input.approvedSourceVersion) return { state: "UNKNOWN", resolvedVersion: null, replacementVersion: null } as const;
  const approved = input.availableVersions.find((item) => item.version === input.approvedSourceVersion);
  if (!approved) return { state: "MISSING", resolvedVersion: input.approvedSourceVersion, replacementVersion: null } as const;
  return {
    state: approved.archived ? "ARCHIVED_PINNED" : approved.replacementVersion ? "REPLACEMENT_AVAILABLE" : "CURRENT",
    resolvedVersion: approved.version,
    replacementVersion: approved.replacementVersion,
  } as const;
}
