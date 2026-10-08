/**
 * Seed Task Type examples for the approved V1 methodology. These are
 * ordinary fixtures/config examples -- nothing in lib/task-type.ts or the
 * UI special-cases any of these ids or names. Deleting one from the
 * library (once persistence exists) would not break any code path.
 */
import { createTaskType, type AssigneeRule, type FieldDefinition, type RecommendedDay, type TaskType, type TaskTypeDraft } from "./task-type";

const OWNER: AssigneeRule = { kind: "DEFAULT_CONTENT_OWNER" };
const fixedRole = (role: string): AssigneeRule => ({ kind: "FIXED_ROLE", role });

const textField = (id: string, label: string, required = true): FieldDefinition => ({ id, label, type: "TEXT", required });
const longTextField = (id: string, label: string, required = true): FieldDefinition => ({ id, label, type: "LONG_TEXT", required });
const urlField = (id: string, label: string, required = false): FieldDefinition => ({ id, label, type: "URL", required });
const booleanField = (id: string, label: string, required = false): FieldDefinition => ({ id, label, type: "BOOLEAN", required });
const dateField = (id: string, label: string, required = true): FieldDefinition => ({ id, label, type: "DATE", required });

function draft(input: {
  name: string;
  description: string;
  requiredFields?: FieldDefinition[];
  optionalFields?: FieldDefinition[];
  defaultPrompt?: string | null;
  promptVersion?: string | null;
  defaultAssigneeRule?: AssigneeRule;
  recommendedDay?: RecommendedDay | null;
  reviewRequired?: boolean;
  allowedLinkLabels?: string[];
}): TaskTypeDraft {
  return {
    name: input.name,
    description: input.description,
    requiredFields: input.requiredFields ?? [],
    optionalFields: input.optionalFields ?? [],
    defaultPrompt: input.defaultPrompt ?? null,
    promptVersion: input.promptVersion ?? (input.defaultPrompt ? "v1" : null),
    defaultAssigneeRule: input.defaultAssigneeRule ?? OWNER,
    recommendedDay: input.recommendedDay ?? null,
    reviewRequired: input.reviewRequired ?? false,
    allowedLinkLabels: input.allowedLinkLabels ?? ["Reference"],
    completionRequirements: [],
  };
}

const FIXTURE_EPOCH_MS = Date.UTC(2026, 9, 8);
let counter = 0;
function seed(input: ReturnType<typeof draft>): TaskType {
  counter += 1;
  const timestamp = new Date(FIXTURE_EPOCH_MS + counter * 1000).toISOString();
  return createTaskType(input, () => timestamp);
}

export const TASK_TYPE_FIXTURES: readonly TaskType[] = [
  seed(draft({
    name: "Problem Split",
    description: "Canonical muammoni Problem Part'larga ajratish.",
    requiredFields: [longTextField("problem-parts", "Problem Part'lar ro'yxati")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Knowledge Discovery",
    description: "Bitta Problem Part uchun Knowledge Node nomzodlarini aniqlash.",
    requiredFields: [longTextField("candidate-nodes", "Nomzod Knowledge Node'lar")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Research",
    description: "Bog'langan Knowledge Node'lar uchun umumiy research artefakti.",
    requiredFields: [longTextField("research-summary", "Research xulosasi")],
    recommendedDay: "MONDAY",
    allowedLinkLabels: ["Reference", "Raw"],
  })),
  seed(draft({
    name: "Blog",
    description: "Canonical blog qoralamasi — birlamchi bilim hujjati.",
    requiredFields: [textField("title", "Sarlavha"), longTextField("body", "Blog matni")],
    defaultPrompt: "Quyidagi research asosida blog qoralamasini yoz.\n\n---\nINPUT:\n",
    reviewRequired: true,
    allowedLinkLabels: ["Reference", "Final"],
  })),
  seed(draft({
    name: "Head Review",
    description: "Head tasdig'i — muhim aktivlar uchun.",
    requiredFields: [booleanField("approved", "Tasdiqlandi")],
    allowedLinkLabels: ["Reference"],
    defaultAssigneeRule: fixedRole("Head"),
  })),
  seed(draft({
    name: "SEO",
    description: "SEO optimizatsiyasi — Head tasdig'ini kutmaydi.",
    requiredFields: [textField("meta-title", "Meta sarlavha"), textField("meta-description", "Meta tavsif")],
    defaultAssigneeRule: fixedRole("SEO"),
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Angle",
    description: "Knowledge Node uchun kamida 5 angle ishlab chiqish.",
    requiredFields: [longTextField("angles", "Angle ro'yxati (kamida 5)")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Performance Consultation",
    description: "Digital marketer bilan destination/offer/CTA maslahati.",
    requiredFields: [longTextField("recommendation", "Tavsiya")],
    defaultAssigneeRule: fixedRole("Digital marketer"),
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Destination Decision",
    description: "Mavjud destination'larni ko'rib chiqish; kerak bo'lsa yangi yaratish.",
    requiredFields: [booleanField("reused-existing", "Mavjud destination ishlatildi")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Repurpose Map",
    description: "Blog'dan atomic idea'larni qo'lda ajratib olish.",
    requiredFields: [longTextField("atomic-ideas", "Atomic idea'lar ro'yxati")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Reel Script",
    description: "Qisqa video uchun ssenariy.",
    requiredFields: [longTextField("script", "Ssenariy")],
    defaultPrompt: "Quyidagi atomic idea asosida reel ssenariysi yoz.\n\n---\nINPUT:\n",
    allowedLinkLabels: ["Script", "Reference"],
  })),
  seed(draft({
    name: "Carousel",
    description: "Karusel slaydlari va matni.",
    requiredFields: [longTextField("slides", "Slayd matnlari")],
    defaultPrompt: "Quyidagi atomic idea asosida karusel matnini yoz.\n\n---\nINPUT:\n",
    recommendedDay: "WEDNESDAY",
    allowedLinkLabels: ["Figma", "Final"],
  })),
  seed(draft({
    name: "Text Post",
    description: "Matnli post.",
    requiredFields: [longTextField("body", "Post matni")],
    defaultPrompt: "Quyidagi atomic idea asosida matnli post yoz.\n\n---\nINPUT:\n",
    allowedLinkLabels: ["Reference", "Final"],
  })),
  seed(draft({
    name: "Planning",
    description: "Haftalik/oylik ishlab chiqarish rejasi.",
    requiredFields: [dateField("target-week", "Maqsad hafta")],
    recommendedDay: "MONDAY",
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Shoot",
    description: "Syomka sessiyasi.",
    requiredFields: [],
    defaultAssigneeRule: fixedRole("Operator / Montajer"),
    recommendedDay: "TUESDAY",
    allowedLinkLabels: ["Raw"],
  })),
  seed(draft({
    name: "Edit",
    description: "Montaj.",
    requiredFields: [urlField("final-cut", "Yakuniy video", true)],
    defaultAssigneeRule: fixedRole("Operator / Montajer"),
    allowedLinkLabels: ["Raw", "Final"],
  })),
  seed(draft({
    name: "Cover",
    description: "Muqova dizayni.",
    requiredFields: [urlField("cover-asset", "Muqova fayli", true)],
    recommendedDay: "WEDNESDAY",
    allowedLinkLabels: ["Figma", "Final"],
  })),
  seed(draft({
    name: "Caption",
    description: "Tavsif/sarlavha matni.",
    requiredFields: [longTextField("caption", "Caption matni")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Distribution Plan",
    description: "Qaysi kanallarda tarqatilishini tanlash.",
    requiredFields: [longTextField("channels", "Tanlangan kanallar")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Publish / Schedule",
    description: "Tanlangan kanal uchun nashr/rejalashtirish.",
    requiredFields: [dateField("scheduled-publish-at", "Rejalashtirilgan nashr vaqti", true)],
    recommendedDay: "THURSDAY",
    allowedLinkLabels: ["Published URL"],
  })),
  seed(draft({
    name: "Publish Check",
    description: "Nashr natijasini tekshirish.",
    requiredFields: [textField("result", "Natija")],
    allowedLinkLabels: ["Published URL"],
  })),
  seed(draft({
    name: "Learning",
    description: "Natija, nima ishladi, keyingi qadam.",
    requiredFields: [textField("result", "Natija"), longTextField("what-worked", "Nima ishladi?"), longTextField("next-step", "Keyingi qadam")],
    allowedLinkLabels: ["Reference"],
  })),
];

export function findTaskTypeFixtureByName(name: string): TaskType | undefined {
  return TASK_TYPE_FIXTURES.find((taskType) => taskType.name === name);
}
