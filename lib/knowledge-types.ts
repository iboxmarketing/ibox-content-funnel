export type AreaId = "xarid" | "ombor" | "savdo" | "moliya" | "management";

export type SheetRecord = Record<string, string>;

export interface KnowledgeArea {
  id: AreaId;
  name: string;
  color: string;
  stageIds: string[];
  processCount: number;
  problemCount: number;
}

export interface KnowledgeStage {
  id: string;
  areaId: AreaId;
  name: string;
  bosqich: string;
  jarayonGuruhi: string;
  processIds: string[];
  processCount: number;
  problemCount: number;
}

export interface KnowledgeProcess {
  id: string;
  areaId: AreaId;
  stageId: string;
  jarayonId: string;
  biznesBolimi: string;
  bosqich: string;
  jarayonGuruhi: string;
  kichikJarayon: string;
  asosiySavol: string;
  kiruvchiMalumot: string;
  asosiyHarakat: string;
  natija: string;
  masul: string;
  roleNormalized: string;
  mosBiznesTuri: string;
  businessTypeNormalized: string;
  segmentUrgusi: string;
  primarySegment: string;
  segmentTags: string;
  mindmapStageId: string;
  mindmapStage: string;
  oldingiJarayonId: string;
  keyingiJarayonId: string;
  problemIds: string[];
}

export interface KnowledgeProblem {
  id: string;
  areaId: AreaId;
  muammoId: string;
  jarayonId: string;
  muammo: string;
  belgilar: string;
  asosiySabab: string;
  qoshimchaSabablar: string;
  operatsionOqibat: string;
  moliyaviyOqibat: string;
  mijozgaTasir: string;
  uzoqMuddatliXavf: string;
  kerakliNatija: string;
  mosBiznesTuri: string;
  businessTypeNormalized: string;
  segmentUrgusi: string;
  primarySegment: string;
  segmentTags: string;
  ustuvorlik: string;
  kontentPotensiali: string;
  canonicalProblemId: string;
  manbaId: string;
}

export interface CanonicalProblem {
  id: string;
  title: string;
  record: SheetRecord;
}

export interface KnowledgeGraph {
  areas: KnowledgeArea[];
  stages: KnowledgeStage[];
  processes: KnowledgeProcess[];
  problems: KnowledgeProblem[];
  canonicalProblems: CanonicalProblem[];
  contentClusters: SheetRecord[];
  meta: {
    loadedAt: string;
    spreadsheetId: string;
    unlinkedProblemCount: number;
    missingCanonicalLinkCount: number;
    duplicateProcessCount: number;
    duplicateProblemCount: number;
    stageCount: number;
    warnings: string[];
  };
}

export type KnowledgeApiResponse =
  | { configured: true; graph: KnowledgeGraph }
  | { configured: false; missing: string[]; spreadsheetIdConfigured: boolean };
