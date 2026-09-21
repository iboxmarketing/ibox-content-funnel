import {
  CTA_DESTINATION_CONTRACT_VERSION,
  createPublicationBinding,
  evaluateCtaDestination,
  type CtaEvaluation,
  type CtaVariant,
  type DestinationDefinition,
  type DestinationReadinessEvidence,
  type NativeCapability,
  type PublicationCtaBinding,
} from "./cta-destination";

export type DemoCtaMaterial = {
  materialId: string;
  angleId: "DEMO-ANG-CP070-A" | "DEMO-ANG-CP070-B";
  titleUz: string;
  formatCode: string;
  channelId: string;
  baseAssetId: string;
  sourceArticleId: string | null;
  sourceArticleVersion: string | null;
  sourcePublicUrlRequired: false;
  variant: CtaVariant;
  binding: PublicationCtaBinding;
  destination: DestinationDefinition | null;
  readinessEvidence: DestinationReadinessEvidence | null;
  nativeCapability: NativeCapability | null;
  evaluation: CtaEvaluation;
};

export type CtaDestinationPreviewFixture = {
  fixtureId: "DEMO_CP070_CTA_DESTINATION";
  origin: "DEMO_CP070";
  contractVersion: typeof CTA_DESTINATION_CONTRACT_VERSION;
  safetyMode: "CO_S3_PREVIEW_ONLY";
  writesToProduction: false;
  packageRoute: {
    packageRef: "DEMO-PKG-CP070";
    angleId: "DEMO-ANG-CP070-A";
    coreQuestionUz: string;
    usefulOutcomeUz: string;
    primaryRoute: { destinationId: "DEMO-ARTICLE-CP070-A"; selectionState: "PROPOSED" };
    alternativeRoutes: Array<{ destinationId: "TL-024"; selectionState: "PROPOSED" }>;
    configVersion: "demo-cp070-route.v1";
  };
  destinations: DestinationDefinition[];
  materials: DemoCtaMaterial[];
  backendProjection: { state: "UNAVAILABLE"; realTaskCount: null; realPublicationCount: null };
};

const articleDestination: DestinationDefinition = {
  destinationId: "DEMO-ARTICLE-CP070-A",
  definitionVersion: "v1",
  type: "ARTICLE",
  targetReference: "demo:cp070:a:article",
  promisedOutcomeUz: "Mijozlar bazasini tekshirish tartibini to‘liq o‘qish",
  language: "UZ",
  audience: "IBOX public audience",
  configuredUrl: "https://fixture.invalid/cp070-a",
  lifecycleStatus: "DRAFT",
  provenance: "DEMO_CP070 fixture; real URL emas",
};

const toolDestination: DestinationDefinition = {
  destinationId: "TL-024",
  definitionVersion: "sheet-observed-v1",
  type: "TOOL",
  targetReference: "14_TOOLS!TL-024",
  promisedOutcomeUz: "Mijozlar bazasini tekshirish checklistidan foydalanish",
  language: "UZ",
  audience: "IBOX public audience",
  configuredUrl: "https://fixture.invalid/tl-024",
  lifecycleStatus: "BACKLOG",
  provenance: "DEMO fixture; Sheetdagi Backlog external readiness dalili emas",
};

const toolNotReady: DestinationReadinessEvidence = {
  destinationId: "TL-024",
  definitionVersion: "sheet-observed-v1",
  evidenceId: "fixture:tl024:not-ready:v1",
  evidenceType: "MANUAL_QA",
  source: "FIXTURE",
  observedTargetReference: "14_TOOLS!TL-024",
  checkedAt: "2026-09-20T12:00:00.000Z",
  checkedBy: "fixture",
  audienceAccessible: false,
  promisedOutcomeMatches: null,
  requiredQaPassed: false,
  revoked: false,
};

const nativeCapability = (channelId: string, formatCode: string, action: NativeCapability["action"]): NativeCapability => ({
  channelId,
  formatCode,
  action,
  supported: true,
  analyticsCount: null,
  evidenceOrigin: "FIXTURE",
});

function buildMaterial(input: {
  materialId: string;
  angleId: DemoCtaMaterial["angleId"];
  titleUz: string;
  formatCode: string;
  channelId: string;
  baseAssetId: string;
  sourceArticleId?: string | null;
  sourceArticleVersion?: string | null;
  variant: CtaVariant;
  destination?: DestinationDefinition | null;
  readinessEvidence?: DestinationReadinessEvidence | null;
  nativeCapability?: NativeCapability | null;
}): DemoCtaMaterial {
  const binding = createPublicationBinding({
    publicationIntentId: `demo-intent:${input.materialId}:${input.channelId}`,
    materialId: input.materialId,
    materialVersion: input.variant.materialVersion,
    ctaVariantId: input.variant.ctaVariantId,
    ctaVariantVersion: input.variant.version,
    destinationId: input.variant.destinationId,
    destinationDefinitionVersion: input.variant.destinationDefinitionVersion,
    nativeTarget: input.variant.nativeTarget,
    channelId: input.channelId,
    occurrenceId: "1",
  });
  return {
    materialId: input.materialId,
    angleId: input.angleId,
    titleUz: input.titleUz,
    formatCode: input.formatCode,
    channelId: input.channelId,
    baseAssetId: input.baseAssetId,
    sourceArticleId: input.sourceArticleId ?? null,
    sourceArticleVersion: input.sourceArticleVersion ?? null,
    sourcePublicUrlRequired: false,
    variant: input.variant,
    binding,
    destination: input.destination ?? null,
    readinessEvidence: input.readinessEvidence ?? null,
    nativeCapability: input.nativeCapability ?? null,
    evaluation: evaluateCtaDestination({
      variant: input.variant,
      destination: input.destination,
      readinessEvidence: input.readinessEvidence,
      nativeCapability: input.nativeCapability,
    }),
  };
}

export function buildDemoCp070CtaPreview(): CtaDestinationPreviewFixture {
  const materials: DemoCtaMaterial[] = [
    buildMaterial({
      materialId: "demo:cp070:a:article-post",
      angleId: "DEMO-ANG-CP070-A",
      titleUz: "Bazadagi muammolarni aniqlash yo‘lini ko‘ring",
      formatCode: "TEXT_POST",
      channelId: "CH-IBOX-TG",
      baseAssetId: "demo:cp070:a:article-post:asset",
      variant: {
        ctaVariantId: "demo-cta:a:read-article",
        version: "v1",
        materialId: "demo:cp070:a:article-post",
        materialVersion: "demo-v1",
        primaryAction: "READ_ARTICLE",
        actionMode: "RESOURCE",
        copyUz: "Tekshirish tartibini maqoladan o‘qing.",
        destinationId: articleDestination.destinationId,
        destinationDefinitionVersion: articleDestination.definitionVersion,
        nativeTarget: null,
        observations: [{ placement: "CAPTION", action: "READ_ARTICLE", copyUz: "Tekshirish tartibini maqoladan o‘qing." }],
        origin: "DEMO_CP070",
      },
      destination: articleDestination,
      readinessEvidence: null,
    }),
    buildMaterial({
      materialId: "demo:cp070:a:tool-post",
      angleId: "DEMO-ANG-CP070-A",
      titleUz: "Mijozlar bazangizni checklist bilan tekshiring",
      formatCode: "TEXT_POST",
      channelId: "CH-IBOX-TG",
      baseAssetId: "demo:cp070:a:tool-post:asset",
      variant: {
        ctaVariantId: "demo-cta:a:use-tool",
        version: "v1",
        materialId: "demo:cp070:a:tool-post",
        materialVersion: "demo-v1",
        primaryAction: "USE_TOOL",
        actionMode: "RESOURCE",
        copyUz: "Bazangizni tekshirish ro‘yxatidan o‘tkazing.",
        destinationId: toolDestination.destinationId,
        destinationDefinitionVersion: toolDestination.definitionVersion,
        nativeTarget: null,
        observations: [{ placement: "CAPTION", action: "USE_TOOL", copyUz: "Bazangizni tekshirish ro‘yxatidan o‘tkazing." }],
        origin: "DEMO_CP070",
      },
      destination: toolDestination,
      readinessEvidence: toolNotReady,
    }),
    buildMaterial({
      materialId: "demo:cp070:a:carousel",
      angleId: "DEMO-ANG-CP070-A",
      titleUz: "Bazani tekshirish uchun 5 signal",
      formatCode: "CAROUSEL",
      channelId: "CH-IBOX-IG",
      baseAssetId: "demo:cp070:a:carousel:asset",
      variant: {
        ctaVariantId: "demo-cta:a:save",
        version: "v1",
        materialId: "demo:cp070:a:carousel",
        materialVersion: "demo-v1",
        primaryAction: "SAVE",
        actionMode: "NATIVE",
        copyUz: "Keyingi baza tekshiruvi uchun saqlang.",
        destinationId: null,
        destinationDefinitionVersion: null,
        nativeTarget: "CURRENT_PUBLICATION",
        observations: [{ placement: "CAPTION", action: "SAVE", copyUz: "Keyingi baza tekshiruvi uchun saqlang." }],
        origin: "DEMO_CP070",
      },
      nativeCapability: nativeCapability("CH-IBOX-IG", "CAROUSEL", "SAVE"),
    }),
    buildMaterial({
      materialId: "demo:cp070:b:short",
      angleId: "DEMO-ANG-CP070-B",
      titleUz: "Sotuvchi almashganda mijoz konteksti yo‘qolmasin",
      formatCode: "SHORT_VIDEO",
      channelId: "CH-IBOX-YT",
      baseAssetId: "demo:cp070:b:short:asset",
      sourceArticleId: "demo:cp070:b:article",
      sourceArticleVersion: "demo-v1",
      variant: {
        ctaVariantId: "demo-cta:b:follow",
        version: "v1",
        materialId: "demo:cp070:b:short",
        materialVersion: "demo-v1",
        primaryAction: "FOLLOW",
        actionMode: "NATIVE",
        copyUz: "Savdo jarayonlari bo‘yicha davomiy materiallar uchun obuna bo‘ling.",
        destinationId: null,
        destinationDefinitionVersion: null,
        nativeTarget: "CH-IBOX-YT",
        observations: [{ placement: "CAPTION", action: "FOLLOW", copyUz: "Savdo jarayonlari bo‘yicha davomiy materiallar uchun obuna bo‘ling." }],
        origin: "DEMO_CP070",
      },
      nativeCapability: nativeCapability("CH-IBOX-YT", "SHORT_VIDEO", "FOLLOW"),
    }),
  ];

  return {
    fixtureId: "DEMO_CP070_CTA_DESTINATION",
    origin: "DEMO_CP070",
    contractVersion: CTA_DESTINATION_CONTRACT_VERSION,
    safetyMode: "CO_S3_PREVIEW_ONLY",
    writesToProduction: false,
    packageRoute: {
      packageRef: "DEMO-PKG-CP070",
      angleId: "DEMO-ANG-CP070-A",
      coreQuestionUz: "Mijozlar bazasiga tayanib ishlash mumkinligini qanday tekshiramiz?",
      usefulOutcomeUz: "Dubl, bo‘sh maydon va yo‘qolgan tarixni ajratib, tuzatishni qayerdan boshlashni aniqlash.",
      primaryRoute: { destinationId: "DEMO-ARTICLE-CP070-A", selectionState: "PROPOSED" },
      alternativeRoutes: [{ destinationId: "TL-024", selectionState: "PROPOSED" }],
      configVersion: "demo-cp070-route.v1",
    },
    destinations: [articleDestination, toolDestination],
    materials,
    backendProjection: { state: "UNAVAILABLE", realTaskCount: null, realPublicationCount: null },
  };
}

export function buildVerifiedArticleEvidence(): DestinationReadinessEvidence {
  return {
    destinationId: articleDestination.destinationId,
    definitionVersion: articleDestination.definitionVersion,
    evidenceId: "fixture:article:manual-qa:v1",
    evidenceType: "MANUAL_QA",
    source: "FIXTURE",
    observedTargetReference: articleDestination.targetReference,
    checkedAt: "2026-09-20T12:30:00.000Z",
    checkedBy: "fixture-reviewer",
    audienceAccessible: true,
    promisedOutcomeMatches: true,
    requiredQaPassed: true,
    revoked: false,
  };
}
