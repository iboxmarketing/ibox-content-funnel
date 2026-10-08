/**
 * Seed Task Type examples for the approved V1 methodology. These are
 * ordinary fixtures/config examples -- nothing in lib/task-type.ts or the
 * UI special-cases any of these ids or names. Deleting one from the
 * library (once persistence exists) would not break any code path.
 */
import { CHANNELS, CTA_TYPES, PUBLISH_CHECK_OUTCOMES, PUBLISH_MODES } from "./content-entity";
import { createTaskType, type AssigneeRule, type FieldDefinition, type RecommendedDay, type TaskType, type TaskTypeDraft } from "./task-type";

const OWNER: AssigneeRule = { kind: "DEFAULT_CONTENT_OWNER" };
const fixedRole = (role: string): AssigneeRule => ({ kind: "FIXED_ROLE", role });

const textField = (id: string, label: string, required = true): FieldDefinition => ({ id, label, type: "TEXT", required });
const longTextField = (id: string, label: string, required = true): FieldDefinition => ({ id, label, type: "LONG_TEXT", required });
const urlField = (id: string, label: string, required = false): FieldDefinition => ({ id, label, type: "URL", required });
const booleanField = (id: string, label: string, required = false): FieldDefinition => ({ id, label, type: "BOOLEAN", required });
const dateTimeField = (id: string, label: string, required = true): FieldDefinition => ({ id, label, type: "DATETIME", required });
const multiSelectField = (id: string, label: string, options: string[], required = true): FieldDefinition => ({ id, label, type: "MULTI_SELECT", required, options: options.map((value) => ({ value, label: value })) });
const dateField = (id: string, label: string, required = true): FieldDefinition => ({ id, label, type: "DATE", required });
const selectField = (id: string, label: string, options: string[], required = true): FieldDefinition => ({ id, label, type: "SELECT", required, options: options.map((value) => ({ value, label: value })) });

/** Sprint 5 (section 5-6): the CTA part shared by every authoring Task Type
 * -- chosen AFTER Material creation, as the last required part of the
 * task. `cta-destination-id` is owned by Task Detail's CTA panel (hidden
 * from the generic field loop), required only when the Material needs an
 * exact Destination (see material-production.ts). */
const CTA_REQUIRED_FIELDS = (): FieldDefinition[] => [selectField("cta-type", "CTA Type", [...CTA_TYPES]), textField("cta-text", "CTA Text")];
const CTA_OPTIONAL_FIELDS = (): FieldDefinition[] => [textField("cta-destination-id", "CTA Destination (ichki)", false)];

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
    requiredFields: [longTextField("components", "Components")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Knowledge Discovery",
    description: "Bitta Problem Part uchun Knowledge Node nomzodlarini aniqlash.",
    requiredFields: [longTextField("knowledge-nodes", "Knowledge Nodes")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Research",
    description: "Bog'langan Knowledge Node'lar uchun umumiy research artefakti.",
    requiredFields: [urlField("research-link", "Research Link", true), longTextField("research-summary", "Research Summary")],
    recommendedDay: "MONDAY",
    allowedLinkLabels: ["Reference", "Raw"],
  })),
  seed(draft({
    name: "Blog",
    description: "Canonical blog qoralamasi — birlamchi bilim hujjati.",
    requiredFields: [urlField("blog-link", "Blog Link", true), textField("blog-title", "Blog Title")],
    optionalFields: [longTextField("body", "Blog matni", false)],
    defaultPrompt: "Quyidagi research asosida blog qoralamasini yoz.\n\n---\nINPUT:\n",
    reviewRequired: true,
    allowedLinkLabels: ["Reference", "Final"],
  })),
  seed(draft({
    name: "Head Review",
    description: "Head tasdig'i — muhim aktivlar uchun.",
    requiredFields: [selectField("review-decision", "Review Decision", ["Approved", "Rejected"]), longTextField("review-note", "Review Note")],
    allowedLinkLabels: ["Reference"],
    defaultAssigneeRule: fixedRole("Head"),
  })),
  seed(draft({
    name: "SEO",
    description: "SEO optimizatsiyasi — Head tasdig'ini kutmaydi.",
    requiredFields: [longTextField("seo-notes", "SEO Notes")],
    defaultAssigneeRule: fixedRole("SEO"),
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Angle",
    description: "Knowledge Node uchun kamida 5 angle ishlab chiqish.",
    requiredFields: [longTextField("angles", "Angles")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Performance Consultation",
    description: "Digital marketer bilan destination/offer/CTA maslahati.",
    requiredFields: [longTextField("recommendation", "Recommendation")],
    optionalFields: [
      longTextField("suggested-messages", "Suggested Messages", false),
      longTextField("suggested-hooks", "Suggested Hooks", false),
      longTextField("suggested-offers", "Suggested Offers", false),
      longTextField("suggested-destination-ideas", "Suggested Destination Ideas", false),
    ],
    defaultAssigneeRule: fixedRole("Digital marketer"),
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Destination Decision",
    description: "Mavjud destination'larni ko'rib chiqish; kerak bo'lsa yangi yaratish. Reuse/Create new qarori Task Detail'ning maxsus bo'limida qilinadi.",
    requiredFields: [
      longTextField("content-perspective", "Content Perspective"),
      longTextField("digital-recommendation", "Digital Recommendation"),
      longTextField("why-selected", "Why Selected"),
      booleanField("create-new", "Create new destination?", true),
    ],
    // "chosen-destination-id" is only required when create-new is false --
    // a plain required field can't express that conditional, so it stays
    // optional here and Task Detail's dedicated Destination Decision block
    // enforces it directly (section 7-9).
    optionalFields: [
      textField("chosen-destination-id", "Chosen Destination (ichki)", false),
      selectField("destination-type", "Destination Type (agar yangi)", ["YOUTUBE", "CHECKLIST_OR_PDF", "EXTERNAL_TOOL_OR_URL"], false),
    ],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Repurpose Map",
    description: "Blog'dan Atomic Idea'larni qo'lda ajratib olish -- Task Detail'ning maxsus Atomic Idea muharririda (structured, free-text emas).",
    requiredFields: [],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Reel Script",
    description: "Qisqa video uchun ssenariy.",
    requiredFields: [textField("hook", "Hook"), longTextField("script", "Script"), ...CTA_REQUIRED_FIELDS()],
    optionalFields: CTA_OPTIONAL_FIELDS(),
    defaultPrompt: "Quyidagi atomic idea asosida reel ssenariysi yoz.\n\n---\nINPUT:\n",
    allowedLinkLabels: ["Script", "Reference"],
  })),
  seed(draft({
    name: "Carousel",
    description: "Karusel slaydlari va matni.",
    requiredFields: [longTextField("slide-structure", "Slide Structure"), longTextField("copy", "Copy"), ...CTA_REQUIRED_FIELDS()],
    optionalFields: CTA_OPTIONAL_FIELDS(),
    defaultPrompt: "Quyidagi atomic idea asosida karusel matnini yoz.\n\n---\nINPUT:\n",
    recommendedDay: "WEDNESDAY",
    allowedLinkLabels: ["Figma", "Final"],
  })),
  seed(draft({
    name: "Text Post",
    description: "Matnli post.",
    requiredFields: [longTextField("post", "Post"), ...CTA_REQUIRED_FIELDS()],
    optionalFields: CTA_OPTIONAL_FIELDS(),
    defaultPrompt: "Quyidagi atomic idea asosida matnli post yoz.\n\n---\nINPUT:\n",
    allowedLinkLabels: ["Reference", "Final"],
  })),
  seed(draft({
    name: "Planning",
    description: "Reel/YouTube Material uchun ishlab chiqarish rejasi -- Shoot Session'dan oldin.",
    requiredFields: [dateField("desired-shoot-date", "Desired Shoot Date")],
    optionalFields: [
      textField("location", "Location", false),
      textField("talent", "People / Talent", false),
      longTextField("equipment", "Equipment / Props", false),
      longTextField("production-notes", "Production Notes", false),
    ],
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
    description: "Bitta Material uchun kanallarni qo'lda tanlash. Complete -> kanallar bo'yicha Preview -> Publish/Schedule tasklar.",
    requiredFields: [multiSelectField("channels", "Kanallar", [...CHANNELS])],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Publish / Schedule",
    description: "Bitta Material x bitta kanal. PUBLISH_NOW yoki SCHEDULE.",
    requiredFields: [selectField("publish-mode", "Publish Mode", [...PUBLISH_MODES])],
    // Conditional rules (SCHEDULE needs scheduledPublishAt; PUBLISH_NOW needs
    // `published` + Result Review Date) live in lib/distribution.ts, not here.
    optionalFields: [
      textField("channel", "Kanal (ichki)", false),
      dateTimeField("scheduled-publish-at", "Scheduled Publish At", false),
      booleanField("published", "Nashr qilindi", false),
      dateField("result-review-at", "Result Review Date", false),
      longTextField("channel-note", "Kanalga xos izoh / copy", false),
      textField("channel-cta-text", "Kanalga xos CTA matni (ixtiyoriy override)", false),
    ],
    recommendedDay: "THURSDAY",
    allowedLinkLabels: ["Published URL", "Final", "Reference"],
  })),
  seed(draft({
    name: "Publish Check",
    description: "Rostan chiqdidimi? Scheduled post uchun.",
    requiredFields: [selectField("outcome", "Natija", [...PUBLISH_CHECK_OUTCOMES])],
    optionalFields: [
      textField("channel", "Kanal (ichki)", false),
      dateField("result-review-at", "Result Review Date", false),
      longTextField("issue-note", "Muammo izohi", false),
    ],
    allowedLinkLabels: ["Published URL", "Reference"],
  })),
  seed(draft({
    name: "Learning",
    description: "Natija, nima ishladi, keyingi qadam. Faqat shu uchta maydon majburiy.",
    requiredFields: [textField("result", "Result"), longTextField("what-worked", "What worked?"), longTextField("next-step", "Next step")],
    allowedLinkLabels: ["Reference"],
  })),
  // --- V1 Sprint 6 ---
  seed(draft({
    name: "Republish / Fix Publish",
    description: "Publish Check muvaffaqiyatsiz yoki muammoli bo'lganda taklif qilinadigan tuzatish/qayta nashr taski.",
    requiredFields: [longTextField("fix-notes", "Fix Notes")],
    optionalFields: [dateTimeField("new-scheduled-publish-at", "Yangi Scheduled Publish At", false), textField("channel", "Kanal (ichki)", false)],
    allowedLinkLabels: ["Published URL", "Reference"],
  })),
  // --- V1 Sprint 4: first production task per Material format (section 17) ---
  seed(draft({
    name: "YouTube",
    description: "YouTube uchun birinchi production task (script/outline).",
    requiredFields: [longTextField("outline", "Outline"), longTextField("script", "Script"), ...CTA_REQUIRED_FIELDS()],
    optionalFields: [longTextField("production-notes", "Production Notes", false), ...CTA_OPTIONAL_FIELDS()],
    defaultPrompt: "Quyidagi atomic idea asosida YouTube video script/outline yoz.\n\n---\nINPUT:\n",
    allowedLinkLabels: ["Script", "Reference"],
  })),
  // --- V1 Sprint 4: first local Destination-creation tasks (section 9) ---
  seed(draft({
    name: "YouTube Outline",
    description: "Yangi YOUTUBE destination uchun birinchi yaratish taski.",
    requiredFields: [longTextField("outline", "Outline")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "Checklist / PDF Creation",
    description: "Yangi CHECKLIST_OR_PDF destination uchun birinchi yaratish taski.",
    requiredFields: [longTextField("content-outline", "Content Outline")],
    allowedLinkLabels: ["Reference"],
  })),
  seed(draft({
    name: "External Tool Setup",
    description: "Yangi EXTERNAL_TOOL_OR_URL destination uchun birinchi sozlash taski.",
    requiredFields: [longTextField("setup-notes", "Setup Notes")],
    optionalFields: [urlField("tool-url", "Tool URL", false)],
    allowedLinkLabels: ["Reference"],
  })),
];

export function findTaskTypeFixtureByName(name: string): TaskType | undefined {
  return TASK_TYPE_FIXTURES.find((taskType) => taskType.name === name);
}
