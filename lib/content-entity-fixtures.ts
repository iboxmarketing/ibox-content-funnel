/**
 * Seed Content Entity fixture for V1 Sprint 3's demo path: enough to show
 * the real hierarchy and a one-to-many flow, not a full taxonomy (per
 * instruction: "Do not seed hundreds of nodes").
 */
import { createDomain, createKnowledgeNode, createProblemCategory, createProblemPart } from "./content-entity";
import type { ContentEntityState } from "./content-entity-store";

const FIXTURE_EPOCH_MS = Date.UTC(2026, 9, 9);
let counter = 0;
function now(): string {
  counter += 1;
  return new Date(FIXTURE_EPOCH_MS + counter * 1000).toISOString();
}

const domain = createDomain("Ombor", now);
const problemCategory = createProblemCategory(domain.id, "Qoldiq noto'g'ri", now);

const PROBLEM_PART_NAMES = [
  "Hisobda ko'p → Omborda kam",
  "Hisobda kam → Omborda ko'p",
  "Filiallar bo'yicha qoldiq farqi",
  "Brak / qaytarilgan tovar",
  "Rezerv qilingan tovar",
  "Inventarizatsiya farqi",
];

const problemParts = PROBLEM_PART_NAMES.map((name) => createProblemPart(problemCategory.id, name, null, now));

const [hisobdaKop, hisobdaKam] = problemParts;

const knowledgeNodes = [
  createKnowledgeNode(hisobdaKop.id, "Yetkazib beruvchi hujjatida xato miqdor ko'rsatilgan", null, now),
  createKnowledgeNode(hisobdaKop.id, "Tizimga ikki marta kiritilgan partiya", null, now),
  createKnowledgeNode(hisobdaKam.id, "Qaytgan tovar qoldiqqa qayta kiritilmagan", null, now),
  createKnowledgeNode(hisobdaKam.id, "Omborchi skanerlamagan chiqim", null, now),
];

export const QOLDIQ_CONTENT_ENTITY_FIXTURE: ContentEntityState = {
  domains: [domain],
  problemCategories: [problemCategory],
  problemParts,
  knowledgeNodes,
  blogs: [],
  materials: [],
};
