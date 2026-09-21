import "server-only";
import { validatePlanningConfig } from "./planning-config";
import { buildCatalogPreview, type CatalogPreview, type CatalogSourceRow, type CatalogTabSnapshot } from "./catalog-adapter";

import { env } from "cloudflare:workers";
import type {
  AreaId,
  CanonicalProblem,
  KnowledgeArea,
  KnowledgeGraph,
  KnowledgeProblem,
  KnowledgeProcess,
  KnowledgeStage,
  SheetRecord,
} from "./knowledge-types";
import type {
  ContentNode,
  ChannelAccount,
  ProductionDataset,
  ProductionHoliday,
  ProductionItem,
  ProductionSetting,
  ProductionTaskStatus,
  ProductionTaskOverride,
  ProductionTool,
  PublishingRule,
  TopicPackagePlan,
  TopicPackageItem,
  LaunchPreparationItem,
  TaskTemplateDefinition,
  WorkflowStepDefinition,
  TeamMember,
  WorkflowStageDefinition,
} from "./production-types";

const AREA_SHEETS: Array<{
  id: AreaId;
  name: string;
  color: string;
  processTab: string;
  problemTab: string;
}> = [
  { id: "xarid", name: "Xarid / Import", color: "#2563EB", processTab: "01_JARAYON_XARITASI", problemTab: "06_XARID_MUAMMOLAR_XARITASI" },
  { id: "ombor", name: "Ombor", color: "#159A67", processTab: "02_OMBOR_JARAYON_XARITASI", problemTab: "07_OMBOR_MUAMMOLAR_XARITASI" },
  { id: "savdo", name: "Savdo", color: "#EA7625", processTab: "03_SAVDO_JARAYON_XARITASI", problemTab: "08_SAVDO_MUAMMOLAR_XARITASI" },
  { id: "moliya", name: "Moliya", color: "#7551C5", processTab: "04_MOLIYA_JARAYON_XARITASI", problemTab: "09_MOLIYA_MUAMMOLAR_XARITASI" },
  { id: "management", name: "Management", color: "#334155", processTab: "05_MANAGEMENT_JARAYON_XARITASI", problemTab: "10_MANAGEMENT_MUAMMOLAR_XARITASI" },
];

const CANONICAL_TAB = "11_CANONICAL_MUAMMOLAR";
const CONTENT_CLUSTER_TAB = "12_CONTENT_CLUSTER_MAP";
const CONTENT_NODES_TAB = "13_CONTENT_NODES";
const TOOLS_TAB = "14_TOOLS";
const PRODUCTION_TAB = "16_PRODUCTION_SYSTEM";
const SETTINGS_TAB = "17_PRODUCTION_SETTINGS";
const TEAM_TAB = "18_TEAM_CAPACITY";
const WORKFLOW_TAB = "19_CONTENT_WORKFLOW";
const PUBLISHING_TAB = "20_PUBLISHING_RULES";
const HOLIDAYS_TAB = "21_HOLIDAYS";
const TASKS_TAB = "22_PRODUCTION_TASKS";
const CHANNELS_TAB = "32_CHANNEL_ACCOUNTS";
const TASK_TEMPLATES_TAB = "23_TASK_TEMPLATES";
const WORKFLOW_STEPS_TAB = "25_WORKFLOW_STEPS";
const TOPIC_PACKAGES_TAB = "33_TOPIC_PACKAGE_PLAN";
const LAUNCH_PREPARATION_TAB = "34_LAUNCH_PREPARATION";
const TOPIC_PACKAGE_ITEMS_TAB = "35_TOPIC_PACKAGE_ITEMS";
const CATALOG_REFERENCE_TABS: Array<[string, string]> = [
  [CANONICAL_TAB, "Canonical_Problem_ID"],
  ["11A_CANONICAL_SUBFAMILIES", "Subfamily_ID"],
  [CONTENT_CLUSTER_TAB, "Cluster_ID"],
  ["12A_KNOWLEDGE_ARCHITECTURE", "Architecture_ID"],
  ["12B_KONTENT_TARJIMA", "Cluster_ID"],
  [CONTENT_NODES_TAB, "Node_ID"],
  [TOOLS_TAB, "Tool_ID"],
  ["15_CUSTOMER_JOURNEY_MOF", "Journey_ID"],
  [SETTINGS_TAB, "Setting_Key"],
  [TEAM_TAB, "Employee_ID"],
  [PUBLISHING_TAB, "Rule_ID"],
  [HOLIDAYS_TAB, "Date"],
  [CHANNELS_TAB, "Channel_Account_ID"],
  [TASK_TEMPLATES_TAB, "Task_Template_ID"],
  ["24_CHECKLIST_TEMPLATES", "Checklist_Template_ID"],
  [WORKFLOW_STEPS_TAB, "Step_ID"],
  ["26_APPROVAL_POLICIES", "Approval_Policy_ID"],
  ["27_ASSIGNMENT_RULES", "Assignment_Rule_ID"],
  ["28_NOTIFICATION_RULES", "Rule_ID"],
  ["29_SHEET_DB_CONTRACT", "Contract_ID"],
  ["95_UI_LUGAT", "Key"],
  ["96_TAXONOMY", "Taxonomy_Type"],
  ["98_ATAMALAR", "O‘zbekcha atama"],
];
const CATALOG_PRIMARY_TABS: Array<[string, string]> = [
  [TOPIC_PACKAGES_TAB, "Package_Plan_ID"],
  [TOPIC_PACKAGE_ITEMS_TAB, "Package_Item_ID"],
];
const CACHE_MS = 20_000;

let tokenCache: { value: string; expiresAt: number } | null = null;
let graphCache: { value: KnowledgeGraph; expiresAt: number } | null = null;
let productionCache: { value: ProductionDataset; expiresAt: number } | null = null;
let catalogCache: { value: CatalogPreview; expiresAt: number } | null = null;

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Google Sheets request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getAccessToken(email: string, privateKey: string) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google authorization failed (${response.status})`);
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Google authorization returned no access token");
  tokenCache = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 };
  return payload.access_token;
}

export function normalizeSheetKey(value: string) {
  return value.toLocaleLowerCase("uz").replace(/[’‘`ʻʼ]/g, "'").replace(/[^a-z0-9а-яёўқғҳ' ]/gi, "").replace(/\s+/g, "");
}

export function readSheetValue(record: SheetRecord, ...aliases: string[]) {
  const normalized = new Map(Object.entries(record).map(([key, value]) => [normalizeSheetKey(key), value]));
  for (const alias of aliases) {
    const value = normalized.get(normalizeSheetKey(alias));
    if (value !== undefined) return value;
  }
  return "";
}

function parseSheetValues(values: unknown[][] | undefined, requiredHeader?: string) {
  if (!values?.length) return { records: [] as SheetRecord[], headers: [] as string[], headerIndex: 0, rowsWithRecords: [] as Array<{ record: SheetRecord; sourceRow: number }> };
  const required = requiredHeader ? normalizeSheetKey(requiredHeader) : "";
  let headerIndex = 0;
  if (required) {
    const found = values.slice(0, 12).findIndex((row) => row.some((cell) => normalizeSheetKey(String(cell ?? "")) === required));
    if (found >= 0) headerIndex = found;
  }
  const headers = values[headerIndex].map((value) => String(value ?? "").trim());
  const rowsWithRecords = values.slice(headerIndex + 1).flatMap((row, dataIndex) => {
    const record: SheetRecord = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = String(row[index] ?? "").trim();
      if (value) hasValue = true;
      record[header] = value;
    });
    return hasValue ? [{ record, sourceRow: headerIndex + dataIndex + 2 }] : [];
  });
  return { records: rowsWithRecords.map((item) => item.record), headers, headerIndex, rowsWithRecords };
}

export function recordsFromValues(values: unknown[][] | undefined, requiredHeader?: string) {
  const parsed = parseSheetValues(values, requiredHeader);
  return { records: parsed.records, headers: parsed.headers };
}

function asBoolean(value: string) {
  return /^(true|1|yes|ha|active)$/i.test(value.trim());
}

function asNumber(value: string, fallback = 0) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitList(value: string) {
  return value.split(/[|,;\n]+/).map((part) => part.trim()).filter(Boolean);
}

function makeStageId(areaId: AreaId, stageId: string, name: string) {
  return `${areaId}::${stageId || normalizeSheetKey(name) || "other"}`;
}

async function fetchTabs(spreadsheetId: string, tabRequirements: Array<[string, string]>) {
  const token = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim(), env.GOOGLE_PRIVATE_KEY);
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`);
  for (const [tab] of tabRequirements) url.searchParams.append("ranges", `'${tab}'!A4:ZZ`);
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const response = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) {
    const message = response.status === 403
      ? "Service account does not have Viewer access to the Sheet"
      : response.status === 404
        ? "Google Sheet yoki kerakli tab topilmadi"
        : `Google Sheets request failed (${response.status})`;
    throw new Error(message);
  }
  const payload = (await response.json()) as { valueRanges?: Array<{ values?: unknown[][] }> };
  const records = new Map<string, SheetRecord[]>();
  const headers = new Map<string, string[]>();
  const sourceRows = new Map<string, CatalogSourceRow[]>();
  tabRequirements.forEach(([tab, requiredHeader], index) => {
    const parsed = parseSheetValues(payload.valueRanges?.[index]?.values, requiredHeader);
    records.set(tab, parsed.records);
    headers.set(tab, parsed.headers);
    sourceRows.set(tab, parsed.rowsWithRecords.map(({ record, sourceRow }) => ({
      sourceTab: tab,
      sourceRow,
      sourceId: tab === "96_TAXONOMY"
        ? `${readSheetValue(record, "Taxonomy_Type")}::${readSheetValue(record, "Value")}`
        : readSheetValue(record, requiredHeader) || `${tab}:unkeyed:${stableRecordKey(record)}`,
      raw: record,
    })));
  });
  return { records, headers, sourceRows };
}

function stableRecordKey(record: SheetRecord) {
  const input = Object.entries(record).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function fetchSheetMetadata(spreadsheetId: string) {
  const token = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim(), env.GOOGLE_PRIVATE_KEY);
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
  url.searchParams.set("fields", "properties(title,locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))");
  const response = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Google Sheets metadata request failed (${response.status})`);
  const payload = (await response.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
  };
  return new Map((payload.sheets ?? []).flatMap((sheet) => {
    const title = sheet.properties?.title;
    if (!title) return [];
    return [[title, {
      sheetId: sheet.properties?.sheetId ?? null,
      rowCount: sheet.properties?.gridProperties?.rowCount ?? null,
      columnCount: sheet.properties?.gridProperties?.columnCount ?? null,
    }] as const];
  }));
}

function canonicalProblemsFrom(records: SheetRecord[]): CanonicalProblem[] {
  return records.flatMap((record) => {
    const id = readSheetValue(record, "Canonical_Problem_ID", "Canonical Problem ID", "ID");
    if (!id) return [];
    return [{ id, title: readSheetValue(record, "Canonical_Muammo", "Canonical_Problem", "Muammo", "Nomi"), record }];
  });
}

export function normalizeKnowledgeGraph(tabs: Map<string, SheetRecord[]>, spreadsheetId: string): KnowledgeGraph {
  const processes: KnowledgeProcess[] = [];
  const problems: KnowledgeProblem[] = [];
  const warnings: string[] = [];
  const seenProcessIds = new Set<string>();
  const seenProblemIds = new Set<string>();
  let duplicateProcessCount = 0;
  let duplicateProblemCount = 0;

  for (const area of AREA_SHEETS) {
    for (const row of tabs.get(area.processTab) ?? []) {
      const jarayonId = readSheetValue(row, "Jarayon_ID", "Jarayon ID");
      if (!jarayonId) continue;
      if (seenProcessIds.has(jarayonId)) {
        duplicateProcessCount += 1;
        warnings.push(`Takrorlangan Jarayon_ID: ${jarayonId}`);
        continue;
      }
      seenProcessIds.add(jarayonId);
      const bosqich = readSheetValue(row, "Bosqich");
      const jarayonGuruhi = readSheetValue(row, "Jarayon_Guruhi", "Jarayon guruhi");
      const mindmapStageId = readSheetValue(row, "Mindmap_Stage_ID", "Mindmap Stage ID");
      const mindmapStage = readSheetValue(row, "Mindmap_Stage", "Mindmap Stage") || bosqich || jarayonGuruhi || "Guruhlanmagan jarayonlar";
      processes.push({
        id: jarayonId,
        areaId: area.id,
        stageId: makeStageId(area.id, mindmapStageId, mindmapStage),
        jarayonId,
        biznesBolimi: readSheetValue(row, "Biznes_Bo‘limi", "Biznes_Bo'limi", "Biznes bo'limi"),
        bosqich,
        jarayonGuruhi,
        kichikJarayon: readSheetValue(row, "Kichik_Jarayon", "Kichik jarayon", "Jarayon"),
        asosiySavol: readSheetValue(row, "Asosiy_Savol", "Asosiy savol"),
        kiruvchiMalumot: readSheetValue(row, "Kiruvchi_Ma’lumot", "Kiruvchi_Ma'lumot", "Kiruvchi ma'lumot"),
        asosiyHarakat: readSheetValue(row, "Asosiy_Harakat", "Asosiy harakat"),
        natija: readSheetValue(row, "Natija"),
        masul: readSheetValue(row, "Mas’ul", "Mas'ul", "Masul"),
        roleNormalized: readSheetValue(row, "Role_Normalized") || readSheetValue(row, "Mas’ul", "Mas'ul", "Masul"),
        mosBiznesTuri: readSheetValue(row, "Mos_Biznes_Turi", "Mos biznes turi"),
        businessTypeNormalized: readSheetValue(row, "Business_Type_Normalized") || readSheetValue(row, "Mos_Biznes_Turi"),
        segmentUrgusi: readSheetValue(row, "Segment_Urg‘usi", "Segment_Urg'usi", "Segment urg'usi"),
        primarySegment: readSheetValue(row, "Primary_Segment") || readSheetValue(row, "Segment_Urg‘usi", "Segment_Urg'usi"),
        segmentTags: readSheetValue(row, "Segment_Tags"),
        mindmapStageId,
        mindmapStage,
        oldingiJarayonId: readSheetValue(row, "Oldingi_Jarayon_ID", "Oldingi Jarayon ID"),
        keyingiJarayonId: readSheetValue(row, "Keyingi_Jarayon_ID", "Keyingi Jarayon ID"),
        problemIds: [],
      });
    }
    for (const row of tabs.get(area.problemTab) ?? []) {
      const muammoId = readSheetValue(row, "Muammo_ID", "Muammo ID");
      if (!muammoId) continue;
      if (seenProblemIds.has(muammoId)) {
        duplicateProblemCount += 1;
        warnings.push(`Takrorlangan Muammo_ID: ${muammoId}`);
        continue;
      }
      seenProblemIds.add(muammoId);
      problems.push({
        id: muammoId,
        areaId: area.id,
        muammoId,
        jarayonId: readSheetValue(row, "Jarayon_ID", "Jarayon ID"),
        muammo: readSheetValue(row, "Muammo", "Muammo_Nomi", "Muammo nomi"),
        belgilar: readSheetValue(row, "Belgilar"),
        asosiySabab: readSheetValue(row, "Asosiy_Sabab", "Asosiy sabab"),
        qoshimchaSabablar: readSheetValue(row, "Qo‘shimcha_Sabablar", "Qo'shimcha_Sabablar", "Qo'shimcha sabablar"),
        operatsionOqibat: readSheetValue(row, "Operatsion_Oqibat", "Operatsion oqibat"),
        moliyaviyOqibat: readSheetValue(row, "Moliyaviy_Oqibat", "Moliyaviy oqibat"),
        mijozgaTasir: readSheetValue(row, "Mijozga_Ta’sir", "Mijozga_Ta'sir", "Mijozga ta'sir"),
        uzoqMuddatliXavf: readSheetValue(row, "Uzoq_Muddatli_Xavf", "Uzoq muddatli xavf"),
        kerakliNatija: readSheetValue(row, "Kerakli_Natija", "Kerakli natija"),
        mosBiznesTuri: readSheetValue(row, "Mos_Biznes_Turi", "Mos biznes turi"),
        businessTypeNormalized: readSheetValue(row, "Business_Type_Normalized") || readSheetValue(row, "Mos_Biznes_Turi"),
        segmentUrgusi: readSheetValue(row, "Segment_Urg‘usi", "Segment_Urg'usi", "Segment urg'usi"),
        primarySegment: readSheetValue(row, "Primary_Segment") || readSheetValue(row, "Segment_Urg‘usi", "Segment_Urg'usi"),
        segmentTags: readSheetValue(row, "Segment_Tags"),
        ustuvorlik: readSheetValue(row, "Ustuvorlik", "Priority"),
        kontentPotensiali: readSheetValue(row, "Kontent_Potensiali", "Kontent potensiali"),
        canonicalProblemId: readSheetValue(row, "Canonical_Problem_ID", "Canonical Problem ID"),
        manbaId: readSheetValue(row, "Manba_ID", "Manba ID"),
      });
    }
  }

  const processById = new Map(processes.map((process) => [process.id, process]));
  let unlinkedProblemCount = 0;
  for (const problem of problems) {
    const process = processById.get(problem.jarayonId);
    if (process) process.problemIds.push(problem.id);
    else unlinkedProblemCount += 1;
  }
  const stageMap = new Map<string, KnowledgeStage>();
  for (const process of processes) {
    const stage = stageMap.get(process.stageId) ?? {
      id: process.stageId, areaId: process.areaId, name: process.mindmapStage, bosqich: process.bosqich,
      jarayonGuruhi: process.jarayonGuruhi, processIds: [], processCount: 0, problemCount: 0,
    };
    stage.processIds.push(process.id);
    stage.processCount += 1;
    stage.problemCount += process.problemIds.length;
    stageMap.set(stage.id, stage);
  }
  const stages = Array.from(stageMap.values());
  const areas: KnowledgeArea[] = AREA_SHEETS.map((definition) => {
    const areaStages = stages.filter((stage) => stage.areaId === definition.id);
    const areaProcesses = processes.filter((process) => process.areaId === definition.id);
    return {
      id: definition.id, name: definition.name, color: definition.color,
      stageIds: areaStages.map((stage) => stage.id), processCount: areaProcesses.length,
      problemCount: areaProcesses.reduce((sum, process) => sum + process.problemIds.length, 0),
    };
  });
  const canonicalProblems = canonicalProblemsFrom(tabs.get(CANONICAL_TAB) ?? []);
  const canonicalIds = new Set(canonicalProblems.map((item) => item.id));
  const missingCanonicalLinkCount = problems.filter((problem) => problem.canonicalProblemId && !canonicalIds.has(problem.canonicalProblemId)).length;
  if (unlinkedProblemCount) warnings.push(`${unlinkedProblemCount} ta muammo Jarayon_ID bilan bog‘lanmagan`);
  if (missingCanonicalLinkCount) warnings.push(`${missingCanonicalLinkCount} ta canonical aloqa topilmadi`);
  return {
    areas, stages, processes, problems, canonicalProblems,
    contentClusters: tabs.get(CONTENT_CLUSTER_TAB) ?? [],
    meta: {
      loadedAt: new Date().toISOString(), spreadsheetId, unlinkedProblemCount, missingCanonicalLinkCount,
      duplicateProcessCount, duplicateProblemCount, stageCount: stages.length, warnings,
    },
  };
}

export function normalizeProductionDataset(tabs: Map<string, SheetRecord[]>, spreadsheetId: string): ProductionDataset {
  const warnings: string[] = [];
  const tools: ProductionTool[] = (tabs.get(TOOLS_TAB) ?? []).flatMap((record) => {
    const toolId = readSheetValue(record, "Tool_ID");
    return toolId ? [{
      toolId,
      clusterId: readSheetValue(record, "Cluster_ID"),
      toolName: readSheetValue(record, "Tool_Name"),
      toolType: readSheetValue(record, "Tool_Type"),
      primaryUseCase: readSheetValue(record, "Primary_Use_Case"),
      status: readSheetValue(record, "Status"),
      priorityBand: readSheetValue(record, "Priority_Band"),
      primarySegment: readSheetValue(record, "Primary_Segment"),
      sourceRecord: record,
    }] : [];
  });
  const taskOverrides: ProductionTaskOverride[] = (tabs.get(TASKS_TAB) ?? []).flatMap((record) => {
    const taskId = readSheetValue(record, "Task_ID");
    if (!taskId) return [];
    const rawStatus = readSheetValue(record, "Status");
    const status = /^(pending|in_progress|blocked|done)$/.test(rawStatus) ? rawStatus as ProductionTaskStatus : "";
    return [{
      taskId,
      productionId: readSheetValue(record, "Production_ID"),
      stageId: readSheetValue(record, "Stage_ID"),
      status,
      assigneeId: readSheetValue(record, "Assignee_ID"),
      startDateOverride: readSheetValue(record, "Start_Date_Override"),
      deadlineOverride: readSheetValue(record, "Deadline_Override"),
      locked: asBoolean(readSheetValue(record, "Locked")),
      notes: readSheetValue(record, "Notes"),
      updatedAt: readSheetValue(record, "Updated_At"),
      active: !readSheetValue(record, "Active") || asBoolean(readSheetValue(record, "Active")),
      sourceRecord: record,
    }];
  });
  const contentNodes: ContentNode[] = (tabs.get(CONTENT_NODES_TAB) ?? []).flatMap((record) => {
    const nodeId = readSheetValue(record, "Node_ID");
    if (!nodeId) return [];
    return [{
      nodeId, architectureId: readSheetValue(record, "Architecture_ID"), clusterId: readSheetValue(record, "Cluster_ID"),
      canonicalProblemIds: splitList(readSheetValue(record, "Canonical_Problem_IDs")), layer: readSheetValue(record, "Layer"),
      mainQuestion: readSheetValue(record, "Main_Question"), workingTitle: readSheetValue(record, "Working_Title"),
      businessType: readSheetValue(record, "Business_Type"), businessTypeNormalized: readSheetValue(record, "Business_Type_Normalized"),
      primarySegment: readSheetValue(record, "Primary_Segment"), segmentTags: readSheetValue(record, "Segment_Tags"),
      contentFormat: readSheetValue(record, "Content_Format"), toolId: readSheetValue(record, "Tool_ID"),
      mofBridgeId: readSheetValue(record, "MOF_Bridge_ID"), publishability: readSheetValue(record, "Publishability"),
      priorityScore: asNumber(readSheetValue(record, "Priority_Score")), priorityBand: readSheetValue(record, "Priority_Band"),
      funnelStage: readSheetValue(record, "Funnel_Stage"), nodeRole: readSheetValue(record, "Node_Role"),
      contentApprovalStatus: readSheetValue(record, "Content_Approval_Status"), sourceRecord: record,
    }];
  });
  const nodeById = new Map(contentNodes.map((node) => [node.nodeId, node]));
  const seenProductionIds = new Set<string>();
  const items: ProductionItem[] = (tabs.get(PRODUCTION_TAB) ?? []).flatMap((record) => {
    const productionId = readSheetValue(record, "Production_ID");
    if (!productionId) return [];
    if (seenProductionIds.has(productionId)) {
      warnings.push(`Takrorlangan Production_ID: ${productionId}`);
      return [];
    }
    seenProductionIds.add(productionId);
    const nodeId = readSheetValue(record, "Node_ID");
    const node = nodeById.get(nodeId);
    if (!node) warnings.push(`${productionId} uchun Node_ID topilmadi: ${nodeId || "bo‘sh"}`);
    const publishDate = readSheetValue(record, "Publish_Date");
    return [{
      productionId, nodeId, clusterId: readSheetValue(record, "Cluster_ID") || node?.clusterId || "",
      layer: readSheetValue(record, "Layer") || node?.layer || "",
      workingTitle: readSheetValue(record, "Working_Title") || node?.workingTitle || productionId,
      mainQuestion: node?.mainQuestion || "", canonicalProblemIds: node?.canonicalProblemIds ?? [],
      businessType: node?.businessTypeNormalized || node?.businessType || "",
      primaryContentType: readSheetValue(record, "Primary_Content_Type") || node?.contentFormat || "",
      primaryPlatform: readSheetValue(record, "Primary_Platform"), language: readSheetValue(record, "Language") || "UZ",
      localizationPlan: readSheetValue(record, "Localization_Plan"), legacyPriority: readSheetValue(record, "Priority"),
      assignee: readSheetValue(record, "Assignee"), deadline: readSheetValue(record, "Deadline"),
      productionStatus: readSheetValue(record, "Production_Status") || "Backlog",
      researchStatus: readSheetValue(record, "Research_Status"), writingStatus: readSheetValue(record, "Writing_Status"),
      reviewStatus: readSheetValue(record, "Review_Status"), publishDate,
      targetPublishDate: readSheetValue(record, "Target_Publish_Date") || publishDate,
      productionStartDate: readSheetValue(record, "Production_Start_Date"),
      scheduleLocked: asBoolean(readSheetValue(record, "Schedule_Locked")),
      sourceArticleNodeId: readSheetValue(record, "Source_Article_Node_ID"),
      derivativePotential: readSheetValue(record, "Derivative_Potential"), toolId: readSheetValue(record, "Tool_ID") || node?.toolId || "",
      journeyId: readSheetValue(record, "Journey_ID"), mofBridgeId: readSheetValue(record, "MOF_Bridge_ID") || node?.mofBridgeId || "",
      notes: readSheetValue(record, "Notes"), publishability: readSheetValue(record, "Publishability") || node?.publishability || "",
      priorityScore: asNumber(readSheetValue(record, "Priority_Score"), node?.priorityScore ?? 0),
      priorityBand: readSheetValue(record, "Priority_Band") || node?.priorityBand || "P3",
      funnelStage: readSheetValue(record, "Funnel_Stage") || node?.funnelStage || "",
      primarySegment: readSheetValue(record, "Primary_Segment") || node?.primarySegment || "",
      urlSlug: readSheetValue(record, "URL_Slug"), nodeRole: readSheetValue(record, "Node_Role") || node?.nodeRole || "",
      contentApprovalStatus: readSheetValue(record, "Content_Approval_Status") || node?.contentApprovalStatus || "",
      sourceRecord: record,
    }];
  });

  const settings: ProductionSetting[] = (tabs.get(SETTINGS_TAB) ?? []).flatMap((record) => {
    const key = readSheetValue(record, "Setting_Key");
    return key ? [{ key, value: readSheetValue(record, "Setting_Value"), unit: readSheetValue(record, "Unit"), description: readSheetValue(record, "Description"), active: asBoolean(readSheetValue(record, "Active")) }] : [];
  });
  const team: TeamMember[] = (tabs.get(TEAM_TAB) ?? []).flatMap((record) => {
    const employeeId = readSheetValue(record, "Employee_ID");
    return employeeId ? [{
      employeeId, employeeName: readSheetValue(record, "Employee_Name") || readSheetValue(record, "Role"), role: readSheetValue(record, "Role"),
      weeklyCapacityHours: asNumber(readSheetValue(record, "Weekly_Capacity_Hours")), maxParallelTasks: asNumber(readSheetValue(record, "Max_Parallel_Tasks")),
      workingDays: splitList(readSheetValue(record, "Working_Days")), workStart: readSheetValue(record, "Work_Start"),
      workEnd: readSheetValue(record, "Work_End"), active: asBoolean(readSheetValue(record, "Active")),
    }] : [];
  });
  const workflow: WorkflowStageDefinition[] = (tabs.get(WORKFLOW_TAB) ?? []).flatMap((record) => {
    const stageId = readSheetValue(record, "Stage_ID");
    return stageId ? [{
      contentType: readSheetValue(record, "Content_Type") || "DEFAULT", stageOrder: asNumber(readSheetValue(record, "Stage_Order")),
      stageId, stageName: readSheetValue(record, "Stage_Name") || stageId, ownerRole: readSheetValue(record, "Owner_Role"),
      durationWorkdays: readSheetValue(record, "Duration_Workdays") ? Number(readSheetValue(record, "Duration_Workdays")) : -1, dependencyStageIds: splitList(readSheetValue(record, "Dependency_Stage_ID")),
      canRunParallel: asBoolean(readSheetValue(record, "Can_Run_Parallel")), reviewRequired: asBoolean(readSheetValue(record, "Review_Required")),
      active: asBoolean(readSheetValue(record, "Active")),
    }] : [];
  });
  const publishingRules: PublishingRule[] = (tabs.get(PUBLISHING_TAB) ?? []).flatMap((record) => {
    const ruleId = readSheetValue(record, "Rule_ID");
    return ruleId ? [{
      ruleId, platform: readSheetValue(record, "Platform"), contentType: readSheetValue(record, "Content_Type") || "DEFAULT",
      language: readSheetValue(record, "Language") || "*", postsPerWeek: asNumber(readSheetValue(record, "Posts_Per_Week")),
      preferredWeekdays: splitList(readSheetValue(record, "Preferred_Weekdays")), preferredTimes: splitList(readSheetValue(record, "Preferred_Times")),
      minimumGapHours: asNumber(readSheetValue(record, "Minimum_Gap_Hours")), priority: asNumber(readSheetValue(record, "Priority")),
      channelAccountId: readSheetValue(record, "Channel_Account_ID"),
      weeklyMax: readSheetValue(record, "Weekly_Max") ? Number(readSheetValue(record, "Weekly_Max")) : null,
      validFrom: readSheetValue(record, "Valid_From"), validTo: readSheetValue(record, "Valid_To"),
      active: asBoolean(readSheetValue(record, "Active")),
    }] : [];
  });
  const holidays: ProductionHoliday[] = (tabs.get(HOLIDAYS_TAB) ?? []).flatMap((record) => {
    const date = readSheetValue(record, "Date");
    return date ? [{ date, name: readSheetValue(record, "Name"), appliesTo: readSheetValue(record, "Applies_To") || "ALL", active: asBoolean(readSheetValue(record, "Active")) }] : [];
  });
  const channels: ChannelAccount[] = (tabs.get(CHANNELS_TAB) ?? []).flatMap((record) => {
    const channelAccountId = readSheetValue(record, "Channel_Account_ID");
    const optionalNumber = (key: string) => readSheetValue(record, key) ? Number(readSheetValue(record, key)) : null;
    return channelAccountId ? [{ channelAccountId, platform: readSheetValue(record, "Platform"), accountName: readSheetValue(record, "Account_Name"), publicUrl: readSheetValue(record, "Public_URL"), timezone: readSheetValue(record, "Timezone"), weeklyMax: optionalNumber("Account_Weekly_Max"), minimumGapMinutes: optionalNumber("Account_Minimum_Gap_Minutes"), active: asBoolean(readSheetValue(record, "Active")) }] : [];
  });
  const topicPackages: TopicPackagePlan[] = (tabs.get(TOPIC_PACKAGES_TAB) ?? []).flatMap((record) => {
    const packagePlanId = readSheetValue(record, "Package_Plan_ID");
    return packagePlanId ? [{
      packagePlanId,
      planningMonth: readSheetValue(record, "Planning_Month"),
      suggestedOrder: asNumber(readSheetValue(record, "Suggested_Order")),
      primaryArea: readSheetValue(record, "Primary_Area"),
      topicUz: readSheetValue(record, "Topic_UZ"),
      clusterId: readSheetValue(record, "Cluster_ID"),
      mainNodeId: readSheetValue(record, "Main_Node_ID"),
      sourceProductionId: readSheetValue(record, "Source_Production_ID"),
      packageObjectiveUz: readSheetValue(record, "Package_Objective_UZ"),
      proposedContentScopeUz: readSheetValue(record, "Proposed_Content_Scope_UZ"),
      planningStatus: readSheetValue(record, "Planning_Status") || "Taklif",
      notesUz: readSheetValue(record, "Notes_UZ"),
      sourceRecord: record,
    }] : [];
  });
  const launchPreparation: LaunchPreparationItem[] = (tabs.get(LAUNCH_PREPARATION_TAB) ?? []).flatMap((record) => {
    const preparationId = readSheetValue(record, "Preparation_ID");
    return preparationId ? [{
      preparationId,
      proposedWindowUz: readSheetValue(record, "Proposed_Window_UZ"),
      stageUz: readSheetValue(record, "Stage_UZ"),
      primaryRole: readSheetValue(record, "Primary_Role"),
      workUz: readSheetValue(record, "Work_UZ"),
      dependencies: splitList(readSheetValue(record, "Dependencies")),
      completionCriteriaUz: readSheetValue(record, "Completion_Criteria_UZ"),
      statusUz: readSheetValue(record, "Status_UZ") || "Reja",
      notesUz: readSheetValue(record, "Notes_UZ"),
      sourceRecord: record,
    }] : [];
  });
  const topicPackageItems: TopicPackageItem[] = (tabs.get(TOPIC_PACKAGE_ITEMS_TAB) ?? []).flatMap((record) => {
    const packageItemId = readSheetValue(record, "Package_Item_ID");
    return packageItemId ? [{
      packageItemId,
      packagePlanId: readSheetValue(record, "Package_Plan_ID"),
      itemOrder: asNumber(readSheetValue(record, "Item_Order")),
      workflowId: readSheetValue(record, "Workflow_ID"),
      formatCode: readSheetValue(record, "Format_Code"),
      workingTitleUz: readSheetValue(record, "Working_Title_UZ"),
      sourceNodeId: readSheetValue(record, "Source_Node_ID"),
      sourceProductionId: readSheetValue(record, "Source_Production_ID"),
      sourcePackageItemId: readSheetValue(record, "Source_Package_Item_ID"),
      channelAccountIds: splitList(readSheetValue(record, "Channel_Account_IDs")),
      language: readSheetValue(record, "Language") || "UZ",
      quantity: Math.max(1, asNumber(readSheetValue(record, "Quantity"), 1)),
      required: asBoolean(readSheetValue(record, "Required")),
      approvalStatus: readSheetValue(record, "Approval_Status") || "Taklif",
      ownerEmployeeId: readSheetValue(record, "Owner_Employee_ID"),
      targetPublishDate: readSheetValue(record, "Target_Publish_Date"),
      scheduleLocked: asBoolean(readSheetValue(record, "Schedule_Locked")),
      runtimeItemId: readSheetValue(record, "Runtime_Item_ID"),
      active: asBoolean(readSheetValue(record, "Active")),
      notesUz: readSheetValue(record, "Notes_UZ"),
      sourceRecord: record,
    }] : [];
  });
  const taskTemplates: TaskTemplateDefinition[] = (tabs.get(TASK_TEMPLATES_TAB) ?? []).flatMap((record) => {
    const taskTemplateId = readSheetValue(record, "Task_Template_ID");
    return taskTemplateId ? [{
      taskTemplateId,
      taskCode: readSheetValue(record, "Task_Code"),
      taskNameUz: readSheetValue(record, "Task_Name_UZ") || readSheetValue(record, "Task_Code"),
      ownerRole: readSheetValue(record, "Owner_Role"),
      assignmentRuleId: readSheetValue(record, "Assignment_Rule_ID"),
      estimateMinutes: readSheetValue(record, "Estimate_Minutes") ? asNumber(readSheetValue(record, "Estimate_Minutes")) : null,
      outputRequired: asBoolean(readSheetValue(record, "Output_Required")),
      outputUz: readSheetValue(record, "Output_UZ"),
      scope: readSheetValue(record, "Scope"),
      approvalPolicyId: readSheetValue(record, "Approval_Policy_ID"),
      activationCondition: readSheetValue(record, "Activation_Condition"),
      templateVersion: readSheetValue(record, "Template_Version"),
      templateStatus: readSheetValue(record, "Template_Status"),
    }] : [];
  });
  const workflowSteps: WorkflowStepDefinition[] = (tabs.get(WORKFLOW_STEPS_TAB) ?? []).flatMap((record) => {
    const stepId = readSheetValue(record, "Step_ID");
    return stepId ? [{
      workflowId: readSheetValue(record, "Workflow_ID"),
      stepId,
      stepOrder: asNumber(readSheetValue(record, "Step_Order")),
      taskTemplateId: readSheetValue(record, "Task_Template_ID"),
      dependencyStepIds: splitList(readSheetValue(record, "Dependency_Step_IDs")),
      scope: readSheetValue(record, "Scope"),
      activationCondition: readSheetValue(record, "Activation_Condition"),
      approvalPolicyId: readSheetValue(record, "Approval_Policy_ID"),
      isMilestone: asBoolean(readSheetValue(record, "Is_Milestone")),
      milestoneUz: readSheetValue(record, "Milestone_UZ"),
      templateVersion: readSheetValue(record, "Template_Version"),
      status: readSheetValue(record, "Status"),
    }] : [];
  });
  if (!settings.some((item) => item.active)) warnings.push("Production settings faol emas");
  if (!workflow.some((item) => item.active)) warnings.push("Content workflow faol emas");
  if (!publishingRules.some((item) => item.active)) warnings.push("Publishing rules faol emas");
  if (topicPackages.length && !topicPackages.some((item) => /^(tanlandi|tasdiqlandi|active|selected|approved)$/i.test(item.planningStatus))) warnings.push("Mavzu paketlari hali Taklif holatida; real tasklar yaratilmaydi");
  if (taskTemplates.some((item) => /^draft$/i.test(item.templateStatus)) || workflowSteps.some((item) => /^draft$/i.test(item.status))) warnings.push("V2 task shablonlari Draft holatida; preview mumkin, runtime aktiv emas");
  return {
    items, contentNodes, tools, taskOverrides, settings, team, workflow, publishingRules, holidays, channels,
    topicPackages, topicPackageItems, launchPreparation, taskTemplates, workflowSteps,
    canonicalProblems: canonicalProblemsFrom(tabs.get(CANONICAL_TAB) ?? []),
    contentClusters: tabs.get(CONTENT_CLUSTER_TAB) ?? [],
    meta: { loadedAt: new Date().toISOString(), spreadsheetId, warnings, taskWriteMode: "SETUP_REQUIRED" },
  };
}

export function getMissingGoogleConfiguration() {
  const required = ["GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"] as const;
  return required.filter((key) => !env[key]?.trim());
}

export async function loadKnowledgeGraph(force = false) {
  if (!force && graphCache && graphCache.expiresAt > Date.now()) return graphCache.value;
  const spreadsheetId = env.GOOGLE_SHEET_ID.trim();
  const requirements: Array<[string, string]> = [
    ...AREA_SHEETS.flatMap((area) => [[area.processTab, "Jarayon_ID"], [area.problemTab, "Muammo_ID"]] as Array<[string, string]>),
    [CANONICAL_TAB, "Canonical_Problem_ID"], [CONTENT_CLUSTER_TAB, "Cluster_ID"],
  ];
  const { records } = await fetchTabs(spreadsheetId, requirements);
  const graph = normalizeKnowledgeGraph(records, spreadsheetId);
  graphCache = { value: graph, expiresAt: Date.now() + CACHE_MS };
  return graph;
}

export async function loadProductionDataset(force = false) {
  if (!force && productionCache && productionCache.expiresAt > Date.now()) return productionCache.value;
  const spreadsheetId = env.GOOGLE_SHEET_ID.trim();
  const requirements: Array<[string, string]> = [
    [CONTENT_NODES_TAB, "Node_ID"], [TOOLS_TAB, "Tool_ID"], [PRODUCTION_TAB, "Production_ID"], [SETTINGS_TAB, "Setting_Key"],
    [TEAM_TAB, "Employee_ID"], [WORKFLOW_TAB, "Stage_ID"], [PUBLISHING_TAB, "Rule_ID"],
    [HOLIDAYS_TAB, "Date"], [TASKS_TAB, "Task_ID"], [CANONICAL_TAB, "Canonical_Problem_ID"], [CONTENT_CLUSTER_TAB, "Cluster_ID"], [CHANNELS_TAB, "Channel_Account_ID"],
    [TASK_TEMPLATES_TAB, "Task_Template_ID"], [WORKFLOW_STEPS_TAB, "Step_ID"], [TOPIC_PACKAGES_TAB, "Package_Plan_ID"], [LAUNCH_PREPARATION_TAB, "Preparation_ID"],
    [TOPIC_PACKAGE_ITEMS_TAB, "Package_Item_ID"],
  ];
  const { records } = await fetchTabs(spreadsheetId, requirements);
  const dataset = normalizeProductionDataset(records, spreadsheetId);
  const errors = validatePlanningConfig(dataset);
  if (errors.length) throw new Error(`Sozlama xatosi: ${errors.join("; ")}`);
  productionCache = { value: dataset, expiresAt: Date.now() + CACHE_MS };
  return dataset;
}

export async function loadCatalogPreview(force = false) {
  if (!force && catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.value;
  const spreadsheetId = env.GOOGLE_SHEET_ID.trim();
  const metadata = await fetchSheetMetadata(spreadsheetId);
  const requirements = [...CATALOG_REFERENCE_TABS, ...CATALOG_PRIMARY_TABS];
  const availableRequirements = requirements.filter(([tab]) => metadata.has(tab));
  const { headers, sourceRows } = await fetchTabs(spreadsheetId, availableRequirements);
  const tabs: CatalogTabSnapshot[] = requirements.map(([title]) => {
    const sheet = metadata.get(title);
    return {
      title,
      sheetId: sheet?.sheetId ?? null,
      rowCount: sheet?.rowCount ?? null,
      columnCount: sheet?.columnCount ?? null,
      headers: headers.get(title) ?? [],
      rows: sourceRows.get(title) ?? [],
    };
  });
  const preview = buildCatalogPreview({
    spreadsheetId,
    capturedAt: new Date().toISOString(),
    tabs,
    backendProjection: { available: false, realTaskCount: null },
  });
  catalogCache = { value: preview, expiresAt: Date.now() + CACHE_MS };
  return preview;
}
