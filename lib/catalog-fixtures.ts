import type { CatalogAngle, CtaContract } from "./catalog-adapter";

export type DemoMaterial = {
  materialId: string;
  angleId: string;
  formatCode: string;
  titleUz: string;
  sourceRelation: {
    sourceEntityId: string | null;
    sourceVersion: string | null;
    sourceUrl: string | null;
    sectionOrTimecode: string | null;
    frameNoteUz: string | null;
    purposeUz: string;
    permissionState: "NOT_PROVIDED" | "FIXTURE_ONLY";
  };
  cta: CtaContract;
  destination: {
    destinationId: string | null;
    destinationType: "NATIVE_ACTION" | "TOOL" | "ARTICLE";
    configuredStatusRaw: string | null;
    runtimeReadiness: "NOT_REQUIRED" | "NOT_READY_FIXTURE" | "UNKNOWN";
  };
  publicationIntents: Array<{ intentId: string; channelAccountId: string; occurrence: number }>;
  productionDependencyIds: string[];
  publishEligibility: "BLOCKED_TOOL_NOT_READY" | "ELIGIBLE_FIXTURE_ONLY" | "DRAFT_NOT_READY";
};

export type DemoCp070Catalog = {
  fixtureId: "DEMO_CP070_CATALOG";
  mode: "DEMO_FIXTURE_ONLY";
  writesToProduction: false;
  canonicalProblem: { canonicalProblemId: "CP-070"; titleUz: string; clusterId: "CL-024"; evidenceBoundaryUz: string };
  angles: CatalogAngle[];
  materials: DemoMaterial[];
  learningOrder: string[];
  publicationOrder: string[];
  relations: {
    learning: Array<{ from: string; to: string }>;
    related: Array<{ from: string; to: string }>;
    source: Array<{ from: string; to: string }>;
    production: Array<{ from: string; to: string }>;
  };
  youtubeDecisions: Array<{
    angleId: string;
    decision: "PENDING" | "YES" | "NO";
    reasonUz: string;
    sourceArticleVersion: string | null;
    independentShortsRemainAvailable: true;
  }>;
};

const nativeSaveCta: CtaContract = {
  state: "VALID",
  primaryType: "SAVE",
  nativeAction: true,
  destinationRef: null,
  variantId: "demo-a-carousel-v1",
};

const toolCta: CtaContract = {
  state: "VALID",
  primaryType: "OPEN_TOOL",
  nativeAction: false,
  destinationRef: "TL-024",
  variantId: "demo-a-tool-post-v1",
};

export function buildDemoCp070Catalog(options: { includeMiddleAngle?: boolean; youtubeDecision?: "PENDING" | "YES" | "NO" } = {}): DemoCp070Catalog {
  const angleA: CatalogAngle = {
    angleId: "DEMO-ANG-CP070-A",
    angleKind: "EXPLICIT_DEMO",
    canonicalProblemIds: ["CP-070"],
    clusterId: "CL-024",
    questionUz: "Mijozlar bazangizga tayanib ishlash mumkinmi?",
    outcomeUz: "Dubl, yetishmayotgan muhim ma’lumot va yo‘qolgan tarixni ajratib tekshirish.",
    boundaryUz: "Baza holatini tekshirish; butun CRMni joriy etish emas.",
    candidateNodeIds: ["ND-024-02", "ND-024-05", "ND-024-06"],
    learningAfterAngleIds: [],
    relatedAngleIds: ["DEMO-ANG-CP070-B"],
    materialRefIds: ["demo:cp070:a:article", "demo:cp070:a:short", "demo:cp070:a:carousel", "demo:cp070:a:tool-post"],
    provenance: null,
  };
  const angleB: CatalogAngle = {
    angleId: "DEMO-ANG-CP070-B",
    angleKind: "EXPLICIT_DEMO",
    canonicalProblemIds: ["CP-070"],
    clusterId: "CL-024",
    questionUz: "Sotuvchi almashganda mijoz bilan ishni qanday uzmaslik kerak?",
    outcomeUz: "Yangi mas’ul ishni davom ettirishi uchun topshiriladigan kontekst va keyingi harakatni belgilash.",
    boundaryUz: "Ishni topshirish; motivatsiya, komissiya yoki butun baza tozalash emas.",
    candidateNodeIds: ["ND-024-01", "ND-024-07", "ND-024-08"],
    learningAfterAngleIds: [options.includeMiddleAngle ? "DEMO-ANG-CP070-C" : "DEMO-ANG-CP070-A"],
    relatedAngleIds: ["DEMO-ANG-CP070-A"],
    materialRefIds: ["demo:cp070:b:article"],
    provenance: null,
  };
  const angleC: CatalogAngle = {
    angleId: "DEMO-ANG-CP070-C",
    angleKind: "EXPLICIT_DEMO",
    canonicalProblemIds: ["CP-070"],
    clusterId: "CL-024",
    questionUz: "Mijoz kartasida topshirish uchun qaysi ma’lumotlar majburiy?",
    outcomeUz: "Topshirish kartasining minimal tarkibini belgilash.",
    boundaryUz: "Maydonlar tarkibi; umumiy CRM tanlash emas.",
    candidateNodeIds: ["ND-024-05", "ND-024-08"],
    learningAfterAngleIds: ["DEMO-ANG-CP070-A"],
    relatedAngleIds: [],
    materialRefIds: [],
    provenance: null,
  };
  const angles = options.includeMiddleAngle ? [angleA, angleC, angleB] : [angleA, angleB];
  const material = (values: DemoMaterial) => values;
  const materials: DemoMaterial[] = [
    material({
      materialId: "demo:cp070:a:article", angleId: angleA.angleId, formatCode: "BLOG", titleUz: "Mijozlar bazasini tekshirish: dubl, bo‘sh maydon va yo‘qolgan tarix",
      sourceRelation: { sourceEntityId: null, sourceVersion: null, sourceUrl: null, sectionOrTimecode: null, frameNoteUz: null, purposeUz: "Tayanch maqola; real eski material berilmagan.", permissionState: "NOT_PROVIDED" },
      cta: { state: "MAPPING_REQUIRED", primaryType: null, nativeAction: false, destinationRef: null, variantId: "demo-a-article-v1" },
      destination: { destinationId: null, destinationType: "ARTICLE", configuredStatusRaw: null, runtimeReadiness: "UNKNOWN" },
      publicationIntents: [{ intentId: "demo-pub:a-article:web:1", channelAccountId: "CH-IBOX-WEB", occurrence: 1 }], productionDependencyIds: [], publishEligibility: "DRAFT_NOT_READY",
    }),
    material({
      materialId: "demo:cp070:a:short", angleId: angleA.angleId, formatCode: "SHORT_VIDEO", titleUz: "Dubl mijoz kartasi nimani buzadi?",
      sourceRelation: { sourceEntityId: "demo:cp070:a:article", sourceVersion: null, sourceUrl: null, sectionOrTimecode: null, frameNoteUz: "Real kadr va timecode taqdim etilmagan.", purposeUz: "Maqoladagi bitta tashxisni qisqa formatga moslashtirish.", permissionState: "NOT_PROVIDED" },
      cta: { state: "MAPPING_REQUIRED", primaryType: null, nativeAction: false, destinationRef: null, variantId: "demo-a-short-v1" },
      destination: { destinationId: null, destinationType: "ARTICLE", configuredStatusRaw: null, runtimeReadiness: "UNKNOWN" },
      publicationIntents: [
        { intentId: "demo-pub:a-short:ig:1", channelAccountId: "CH-IBOX-IG", occurrence: 1 },
        { intentId: "demo-pub:a-short:yt:1", channelAccountId: "CH-IBOX-YT", occurrence: 1 },
        { intentId: "demo-pub:a-short:tg:1", channelAccountId: "CH-IBOX-TG", occurrence: 1 },
      ], productionDependencyIds: ["demo:cp070:a:article"], publishEligibility: "DRAFT_NOT_READY",
    }),
    material({
      materialId: "demo:cp070:a:carousel", angleId: angleA.angleId, formatCode: "CAROUSEL", titleUz: "Bazani tekshirish uchun 5 signal",
      sourceRelation: { sourceEntityId: "demo:cp070:a:article", sourceVersion: null, sourceUrl: null, sectionOrTimecode: null, frameNoteUz: null, purposeUz: "Maqoladagi tekshiruv savollarini vizual ketma-ketlikka aylantirish.", permissionState: "FIXTURE_ONLY" },
      cta: nativeSaveCta,
      destination: { destinationId: null, destinationType: "NATIVE_ACTION", configuredStatusRaw: null, runtimeReadiness: "NOT_REQUIRED" },
      publicationIntents: [{ intentId: "demo-pub:a-carousel:ig:1", channelAccountId: "CH-IBOX-IG", occurrence: 1 }], productionDependencyIds: [], publishEligibility: "ELIGIBLE_FIXTURE_ONLY",
    }),
    material({
      materialId: "demo:cp070:a:tool-post", angleId: angleA.angleId, formatCode: "TEXT_POST", titleUz: "Mijozlar bazangizni bepul tekshirib ko‘ring",
      sourceRelation: { sourceEntityId: "demo:cp070:a:article", sourceVersion: null, sourceUrl: null, sectionOrTimecode: null, frameNoteUz: null, purposeUz: "TL-024 checklistiga yo‘naltiruvchi post.", permissionState: "FIXTURE_ONLY" },
      cta: toolCta,
      destination: { destinationId: "TL-024", destinationType: "TOOL", configuredStatusRaw: "Backlog", runtimeReadiness: "NOT_READY_FIXTURE" },
      publicationIntents: [{ intentId: "demo-pub:a-tool-post:tg:1", channelAccountId: "CH-IBOX-TG", occurrence: 1 }], productionDependencyIds: [], publishEligibility: "BLOCKED_TOOL_NOT_READY",
    }),
    material({
      materialId: "demo:cp070:b:article", angleId: angleB.angleId, formatCode: "BLOG", titleUz: "Sotuvchi almashganda mijoz kontekstini yo‘qotmaslik",
      sourceRelation: { sourceEntityId: null, sourceVersion: null, sourceUrl: null, sectionOrTimecode: null, frameNoteUz: null, purposeUz: "B angle uchun tayanch maqola; demo publication tartibida A’dan oldin turishi mumkin.", permissionState: "NOT_PROVIDED" },
      cta: { state: "MAPPING_REQUIRED", primaryType: null, nativeAction: false, destinationRef: null, variantId: "demo-b-article-v1" },
      destination: { destinationId: null, destinationType: "ARTICLE", configuredStatusRaw: null, runtimeReadiness: "UNKNOWN" },
      publicationIntents: [{ intentId: "demo-pub:b-article:web:1", channelAccountId: "CH-IBOX-WEB", occurrence: 1 }], productionDependencyIds: [], publishEligibility: "DRAFT_NOT_READY",
    }),
  ];
  const learningOrder = options.includeMiddleAngle ? [angleA.angleId, angleC.angleId, angleB.angleId] : [angleA.angleId, angleB.angleId];
  return {
    fixtureId: "DEMO_CP070_CATALOG",
    mode: "DEMO_FIXTURE_ONLY",
    writesToProduction: false,
    canonicalProblem: { canonicalProblemId: "CP-070", titleUz: "Mijoz ma’lumotlari yagona bazada emas", clusterId: "CL-024", evidenceBoundaryUz: "Sheetdagi ichki signal; real mijoz case’i yoki bozor statistikasi emas." },
    angles,
    materials,
    learningOrder,
    publicationOrder: [angleB.angleId, angleA.angleId],
    relations: {
      learning: learningOrder.slice(1).map((to, index) => ({ from: learningOrder[index], to })),
      related: [{ from: angleA.angleId, to: angleB.angleId }, { from: angleB.angleId, to: angleA.angleId }],
      source: [{ from: "demo:cp070:a:article", to: "demo:cp070:a:short" }],
      production: [{ from: "demo:cp070:a:article", to: "demo:cp070:a:short" }],
    },
    youtubeDecisions: angles.map((angle) => ({
      angleId: angle.angleId,
      decision: options.youtubeDecision ?? "PENDING",
      reasonUz: options.youtubeDecision === "NO" ? "Uzun video tarmog‘i tanlanmadi; short va YouTube Posts mustaqil qoladi." : "Tayanch maqola/material versiyasi hali tasdiqlanmagan.",
      sourceArticleVersion: null,
      independentShortsRemainAvailable: true,
    })),
  };
}
