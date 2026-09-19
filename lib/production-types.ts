import type { CanonicalProblem, SheetRecord } from "./knowledge-types";

export type PriorityBand = "P0" | "P1" | "P2" | "P3" | string;
export type ProductionTaskStatus = "pending" | "in_progress" | "blocked" | "done";

export interface ContentNode {
  nodeId: string;
  architectureId: string;
  clusterId: string;
  canonicalProblemIds: string[];
  layer: string;
  mainQuestion: string;
  workingTitle: string;
  businessType: string;
  businessTypeNormalized: string;
  primarySegment: string;
  segmentTags: string;
  contentFormat: string;
  toolId: string;
  mofBridgeId: string;
  publishability: string;
  priorityScore: number;
  priorityBand: PriorityBand;
  funnelStage: string;
  nodeRole: string;
  contentApprovalStatus: string;
  sourceRecord: SheetRecord;
}

export interface ProductionItem {
  productionId: string;
  nodeId: string;
  clusterId: string;
  layer: string;
  workingTitle: string;
  mainQuestion: string;
  canonicalProblemIds: string[];
  businessType: string;
  primaryContentType: string;
  primaryPlatform: string;
  language: string;
  localizationPlan: string;
  legacyPriority: string;
  assignee: string;
  deadline: string;
  productionStatus: string;
  researchStatus: string;
  writingStatus: string;
  reviewStatus: string;
  publishDate: string;
  targetPublishDate: string;
  productionStartDate: string;
  scheduleLocked: boolean;
  sourceArticleNodeId: string;
  derivativePotential: string;
  toolId: string;
  journeyId: string;
  mofBridgeId: string;
  notes: string;
  publishability: string;
  priorityScore: number;
  priorityBand: PriorityBand;
  funnelStage: string;
  primarySegment: string;
  urlSlug: string;
  nodeRole: string;
  contentApprovalStatus: string;
  sourceRecord: SheetRecord;
}

export interface ProductionSetting {
  key: string;
  value: string;
  unit: string;
  description: string;
  active: boolean;
}

export interface TeamMember {
  employeeId: string;
  employeeName: string;
  role: string;
  weeklyCapacityHours: number;
  maxParallelTasks: number;
  workingDays: string[];
  workStart: string;
  workEnd: string;
  active: boolean;
}

export interface WorkflowStageDefinition {
  contentType: string;
  stageOrder: number;
  stageId: string;
  stageName: string;
  ownerRole: string;
  durationWorkdays: number;
  dependencyStageIds: string[];
  canRunParallel: boolean;
  reviewRequired: boolean;
  active: boolean;
}

export interface PublishingRule {
  ruleId: string;
  platform: string;
  contentType: string;
  language: string;
  postsPerWeek: number;
  preferredWeekdays: string[];
  preferredTimes: string[];
  minimumGapHours: number;
  priority: number;
  active: boolean;
  channelAccountId?: string;
  weeklyMax?: number | null;
  validFrom?: string;
  validTo?: string;
}

export interface ChannelAccount {
  channelAccountId: string;
  platform: string;
  accountName: string;
  publicUrl: string;
  timezone: string;
  weeklyMax: number | null;
  minimumGapMinutes: number | null;
  active: boolean;
}

export interface ProductionHoliday {
  date: string;
  name: string;
  appliesTo: string;
  active: boolean;
}

export interface ProductionTool {
  toolId: string;
  clusterId: string;
  toolName: string;
  toolType: string;
  primaryUseCase: string;
  status: string;
  priorityBand: PriorityBand;
  primarySegment: string;
  sourceRecord: SheetRecord;
}

export interface ProductionTaskOverride {
  taskId: string;
  productionId: string;
  stageId: string;
  status: ProductionTaskStatus | "";
  assigneeId: string;
  startDateOverride: string;
  deadlineOverride: string;
  locked: boolean;
  notes: string;
  updatedAt: string;
  active: boolean;
  sourceRecord: SheetRecord;
}

export interface TopicPackagePlan {
  packagePlanId: string;
  planningMonth: string;
  suggestedOrder: number;
  primaryArea: string;
  topicUz: string;
  clusterId: string;
  mainNodeId: string;
  sourceProductionId: string;
  packageObjectiveUz: string;
  proposedContentScopeUz: string;
  planningStatus: string;
  notesUz: string;
  sourceRecord: SheetRecord;
}

export interface TopicPackageItem {
  packageItemId: string;
  packagePlanId: string;
  itemOrder: number;
  workflowId: string;
  formatCode: string;
  workingTitleUz: string;
  sourceNodeId: string;
  sourceProductionId: string;
  sourcePackageItemId: string;
  channelAccountIds: string[];
  language: string;
  quantity: number;
  required: boolean;
  approvalStatus: string;
  ownerEmployeeId: string;
  targetPublishDate: string;
  scheduleLocked: boolean;
  runtimeItemId: string;
  active: boolean;
  notesUz: string;
  sourceRecord: SheetRecord;
}

export interface LaunchPreparationItem {
  preparationId: string;
  proposedWindowUz: string;
  stageUz: string;
  primaryRole: string;
  workUz: string;
  dependencies: string[];
  completionCriteriaUz: string;
  statusUz: string;
  notesUz: string;
  sourceRecord: SheetRecord;
}

export interface TaskTemplateDefinition {
  taskTemplateId: string;
  taskCode: string;
  taskNameUz: string;
  ownerRole: string;
  assignmentRuleId: string;
  estimateMinutes: number | null;
  outputRequired: boolean;
  outputUz: string;
  scope: string;
  approvalPolicyId: string;
  activationCondition: string;
  templateVersion: string;
  templateStatus: string;
}

export interface WorkflowStepDefinition {
  workflowId: string;
  stepId: string;
  stepOrder: number;
  taskTemplateId: string;
  dependencyStepIds: string[];
  scope: string;
  activationCondition: string;
  approvalPolicyId: string;
  isMilestone: boolean;
  milestoneUz: string;
  templateVersion: string;
  status: string;
}

export interface ProductionDataset {
  items: ProductionItem[];
  contentNodes: ContentNode[];
  tools: ProductionTool[];
  taskOverrides: ProductionTaskOverride[];
  settings: ProductionSetting[];
  team: TeamMember[];
  workflow: WorkflowStageDefinition[];
  publishingRules: PublishingRule[];
  holidays: ProductionHoliday[];
  channels?: ChannelAccount[];
  topicPackages: TopicPackagePlan[];
  topicPackageItems: TopicPackageItem[];
  launchPreparation: LaunchPreparationItem[];
  taskTemplates: TaskTemplateDefinition[];
  workflowSteps: WorkflowStepDefinition[];
  canonicalProblems: CanonicalProblem[];
  contentClusters: SheetRecord[];
  meta: {
    loadedAt: string;
    spreadsheetId: string;
    warnings: string[];
    sheetIds?: Record<string, number>;
    taskWriteMode?: "TASK_BACKEND" | "SETUP_REQUIRED";
  };
}

export type ProductionApiResponse =
  | { configured: true; dataset: ProductionDataset }
  | { configured: false; missing: string[]; spreadsheetIdConfigured: boolean };

export interface ScheduledStage {
  taskId: string;
  stageId: string;
  stageName: string;
  ownerRole: string;
  ownerId: string;
  ownerName: string;
  startDate: string;
  endDate: string;
  durationWorkdays: number;
  dependencyStageIds: string[];
  status: "done" | "in_progress" | "pending" | "blocked";
  capacityWarning: string;
  estimatedHours: number;
  locked: boolean;
  notes: string;
  startAt?: string;
  endAt?: string;
  workSegments?: Array<{ startAt: string; endAt: string }>;
}

export interface ProductionPlan {
  item: ProductionItem;
  stages: ScheduledStage[];
  currentOwner: string;
  currentRole: string;
  nextDeadline: string;
  contentReadyDate: string;
  recommendedPublishDate: string;
  scheduledPublishDate: string;
  earliestPossiblePublishDate: string;
  scheduleRisk: "on_track" | "at_risk" | "late";
  overdue: boolean;
  blocked: boolean;
  unscheduledReason: string;
  capacityWarnings: string[];
}

export interface TeamCapacitySummary {
  employeeId: string;
  employeeName: string;
  role: string;
  week: string;
  scheduledHours: number;
  weeklyCapacityHours: number;
  utilization: number;
  activeParallelTasks: number;
  maxParallelTasks: number;
  overCapacity: boolean;
  parallelConflict: boolean;
}

export interface PublishingSlot {
  ruleId: string;
  platform: string;
  contentType: string;
  language: string;
  startsAt: string;
  locked?: boolean;
  productionId?: string;
  channelAccountId?: string;
}

export interface ScheduleResult {
  plans: ProductionPlan[];
  capacity: TeamCapacitySummary[];
  slots: PublishingSlot[];
  generatedAt: string;
}
