import type { CanonicalProblem, SheetRecord } from "./knowledge-types";

export type PriorityBand = "P0" | "P1" | "P2" | "P3" | string;

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
}

export interface ProductionHoliday {
  date: string;
  name: string;
  appliesTo: string;
  active: boolean;
}

export interface ProductionDataset {
  items: ProductionItem[];
  contentNodes: ContentNode[];
  settings: ProductionSetting[];
  team: TeamMember[];
  workflow: WorkflowStageDefinition[];
  publishingRules: PublishingRule[];
  holidays: ProductionHoliday[];
  canonicalProblems: CanonicalProblem[];
  contentClusters: SheetRecord[];
  meta: {
    loadedAt: string;
    spreadsheetId: string;
    warnings: string[];
  };
}

export type ProductionApiResponse =
  | { configured: true; dataset: ProductionDataset }
  | { configured: false; missing: string[]; spreadsheetIdConfigured: boolean };

export interface ScheduledStage {
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
}

export interface ScheduleResult {
  plans: ProductionPlan[];
  capacity: TeamCapacitySummary[];
  slots: PublishingSlot[];
  generatedAt: string;
}
