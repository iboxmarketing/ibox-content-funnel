import "server-only";

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

let tokenCache: { value: string; expiresAt: number } | null = null;

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
  const response = await fetch("https://oauth2.googleapis.com/token", {
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

function toRecords(values: unknown[][] | undefined): SheetRecord[] {
  if (!values?.length) return [];
  const headers = values[0].map((value) => String(value ?? "").trim());
  return values.slice(1).flatMap((row) => {
    const record: SheetRecord = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = String(row[index] ?? "").trim();
      if (value) hasValue = true;
      record[header] = value;
    });
    return hasValue ? [record] : [];
  });
}

function normalizeKey(value: string) {
  return value
    .toLocaleLowerCase("uz")
    .replace(/[’‘`ʻʼ]/g, "'")
    .replace(/[^a-z0-9а-яёўқғҳ' ]/gi, "")
    .replace(/\s+/g, "");
}

function read(record: SheetRecord, ...aliases: string[]) {
  const normalized = new Map(Object.entries(record).map(([key, value]) => [normalizeKey(key), value]));
  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias));
    if (value !== undefined) return value;
  }
  return "";
}

function stageName(bosqich: string, group: string) {
  if (bosqich && group && normalizeKey(bosqich) !== normalizeKey(group)) return `${bosqich} · ${group}`;
  return bosqich || group || "Guruhlanmagan jarayonlar";
}

function makeStageId(areaId: AreaId, name: string) {
  return `${areaId}::${normalizeKey(name) || "other"}`;
}

function normalizeGraph(tabs: Map<string, SheetRecord[]>, spreadsheetId: string): KnowledgeGraph {
  const processes: KnowledgeProcess[] = [];
  const problems: KnowledgeProblem[] = [];
  const warnings: string[] = [];
  const seenProcessIds = new Set<string>();
  const seenProblemIds = new Set<string>();

  for (const area of AREA_SHEETS) {
    for (const row of tabs.get(area.processTab) ?? []) {
      const jarayonId = read(row, "Jarayon_ID", "Jarayon ID");
      if (!jarayonId) continue;
      if (seenProcessIds.has(jarayonId)) {
        warnings.push(`Takrorlangan Jarayon_ID: ${jarayonId}`);
        continue;
      }
      seenProcessIds.add(jarayonId);
      const bosqich = read(row, "Bosqich");
      const jarayonGuruhi = read(row, "Jarayon_Guruhi", "Jarayon guruhi");
      const groupName = stageName(bosqich, jarayonGuruhi);
      processes.push({
        id: jarayonId,
        areaId: area.id,
        stageId: makeStageId(area.id, groupName),
        jarayonId,
        biznesBolimi: read(row, "Biznes_Bo‘limi", "Biznes_Bo'limi", "Biznes bo'limi"),
        bosqich,
        jarayonGuruhi,
        kichikJarayon: read(row, "Kichik_Jarayon", "Kichik jarayon", "Jarayon"),
        asosiySavol: read(row, "Asosiy_Savol", "Asosiy savol"),
        kiruvchiMalumot: read(row, "Kiruvchi_Ma’lumot", "Kiruvchi_Ma'lumot", "Kiruvchi ma'lumot"),
        asosiyHarakat: read(row, "Asosiy_Harakat", "Asosiy harakat"),
        natija: read(row, "Natija"),
        masul: read(row, "Mas’ul", "Mas'ul", "Masul"),
        mosBiznesTuri: read(row, "Mos_Biznes_Turi", "Mos biznes turi"),
        segmentUrgusi: read(row, "Segment_Urg‘usi", "Segment_Urg'usi", "Segment urg'usi"),
        oldingiJarayonId: read(row, "Oldingi_Jarayon_ID", "Oldingi Jarayon ID"),
        keyingiJarayonId: read(row, "Keyingi_Jarayon_ID", "Keyingi Jarayon ID"),
        problemIds: [],
      });
    }

    for (const row of tabs.get(area.problemTab) ?? []) {
      const muammoId = read(row, "Muammo_ID", "Muammo ID");
      if (!muammoId) continue;
      if (seenProblemIds.has(muammoId)) {
        warnings.push(`Takrorlangan Muammo_ID: ${muammoId}`);
        continue;
      }
      seenProblemIds.add(muammoId);
      problems.push({
        id: muammoId,
        areaId: area.id,
        muammoId,
        jarayonId: read(row, "Jarayon_ID", "Jarayon ID"),
        muammo: read(row, "Muammo", "Muammo_Nomi", "Muammo nomi"),
        belgilar: read(row, "Belgilar"),
        asosiySabab: read(row, "Asosiy_Sabab", "Asosiy sabab"),
        qoshimchaSabablar: read(row, "Qo‘shimcha_Sabablar", "Qo'shimcha_Sabablar", "Qo'shimcha sabablar"),
        operatsionOqibat: read(row, "Operatsion_Oqibat", "Operatsion oqibat"),
        moliyaviyOqibat: read(row, "Moliyaviy_Oqibat", "Moliyaviy oqibat"),
        mijozgaTasir: read(row, "Mijozga_Ta’sir", "Mijozga_Ta'sir", "Mijozga ta'sir"),
        uzoqMuddatliXavf: read(row, "Uzoq_Muddatli_Xavf", "Uzoq muddatli xavf"),
        kerakliNatija: read(row, "Kerakli_Natija", "Kerakli natija"),
        mosBiznesTuri: read(row, "Mos_Biznes_Turi", "Mos biznes turi"),
        segmentUrgusi: read(row, "Segment_Urg‘usi", "Segment_Urg'usi", "Segment urg'usi"),
        ustuvorlik: read(row, "Ustuvorlik", "Priority"),
        kontentPotensiali: read(row, "Kontent_Potensiali", "Kontent potensiali"),
        canonicalProblemId: read(row, "Canonical_Problem_ID", "Canonical Problem ID"),
        manbaId: read(row, "Manba_ID", "Manba ID"),
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
    const name = stageName(process.bosqich, process.jarayonGuruhi);
    const stage = stageMap.get(process.stageId) ?? {
      id: process.stageId,
      areaId: process.areaId,
      name,
      bosqich: process.bosqich,
      jarayonGuruhi: process.jarayonGuruhi,
      processIds: [],
      processCount: 0,
      problemCount: 0,
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
      id: definition.id,
      name: definition.name,
      color: definition.color,
      stageIds: areaStages.map((stage) => stage.id),
      processCount: areaProcesses.length,
      problemCount: areaProcesses.reduce((sum, process) => sum + process.problemIds.length, 0),
    };
  });

  const canonicalProblems: CanonicalProblem[] = (tabs.get(CANONICAL_TAB) ?? []).flatMap((record) => {
    const id = read(record, "Canonical_Problem_ID", "Canonical Problem ID", "ID");
    if (!id) return [];
    return [{ id, title: read(record, "Canonical_Muammo", "Canonical_Problem", "Muammo", "Nomi"), record }];
  });

  return {
    areas,
    stages,
    processes,
    problems,
    canonicalProblems,
    contentClusters: tabs.get(CONTENT_CLUSTER_TAB) ?? [],
    meta: { loadedAt: new Date().toISOString(), spreadsheetId, unlinkedProblemCount, warnings },
  };
}

export function getMissingGoogleConfiguration() {
  const required = ["GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"] as const;
  return required.filter((key) => !env[key]?.trim());
}

export async function loadKnowledgeGraph() {
  const spreadsheetId = env.GOOGLE_SHEET_ID.trim();
  const token = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim(), env.GOOGLE_PRIVATE_KEY);
  const tabs = [...AREA_SHEETS.flatMap((area) => [area.processTab, area.problemTab]), CANONICAL_TAB, CONTENT_CLUSTER_TAB];
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`);
  for (const tab of tabs) url.searchParams.append("ranges", `'${tab}'!A:ZZ`);
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");

  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) {
    const message = response.status === 403 ? "Service account does not have Viewer access to the Sheet" : `Google Sheets request failed (${response.status})`;
    throw new Error(message);
  }
  const payload = (await response.json()) as { valueRanges?: Array<{ values?: unknown[][] }> };
  const recordTabs = new Map<string, SheetRecord[]>();
  tabs.forEach((tab, index) => recordTabs.set(tab, toRecords(payload.valueRanges?.[index]?.values)));
  return normalizeGraph(recordTabs, spreadsheetId);
}
