/**
 * Stable-ref reconciliation: compares a Sheet-sourced projection against a
 * Supabase-sourced projection of the same entities, keyed by the stable
 * reference IDs the migration must preserve (CP-*, CL-*, ND-*, TP-*, TPI-*,
 * TT-*, Workflow_ID, Step_ID values). Pure and source-agnostic -- it never
 * reads a Sheet or a Supabase table itself, only compares two already-loaded
 * arrays, so it can be exercised with fixtures before any real Supabase data
 * exists.
 */

export interface StableRefRecord {
  readonly stableRef: string;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
  /** Optional revision marker (e.g. a manifest hash or updated-at value). */
  readonly version?: string | null;
}

export type ReconciliationMismatchCategory =
  | "MISSING_IN_SUPABASE"
  | "MISSING_IN_SHEET"
  | "FIELD_DIFF"
  | "DUPLICATE_STABLE_REF"
  | "VERSION_DIFF";

export interface ReconciliationMismatch {
  readonly stableRef: string;
  readonly category: ReconciliationMismatchCategory;
  readonly detail: string;
  readonly sheetValue?: unknown;
  readonly supabaseValue?: unknown;
}

export interface ReconciliationReport {
  readonly mismatches: readonly ReconciliationMismatch[];
  readonly matchedCount: number;
  readonly sheetCount: number;
  readonly supabaseCount: number;
}

export function reconcileByStableRef(
  sheetRecords: readonly StableRefRecord[],
  supabaseRecords: readonly StableRefRecord[],
): ReconciliationReport {
  const mismatches: ReconciliationMismatch[] = [];
  const sheetByRef = groupByStableRef(sheetRecords);
  const supabaseByRef = groupByStableRef(supabaseRecords);
  const duplicatedRefs = new Set<string>();

  for (const [ref, records] of sheetByRef) {
    if (records.length > 1) {
      duplicatedRefs.add(ref);
      mismatches.push({
        stableRef: ref,
        category: "DUPLICATE_STABLE_REF",
        detail: `Sheet has ${records.length} rows for "${ref}"`,
      });
    }
  }
  for (const [ref, records] of supabaseByRef) {
    if (records.length > 1) {
      duplicatedRefs.add(ref);
      mismatches.push({
        stableRef: ref,
        category: "DUPLICATE_STABLE_REF",
        detail: `Supabase has ${records.length} rows for "${ref}"`,
      });
    }
  }

  let matchedCount = 0;
  const allRefs = new Set<string>([...sheetByRef.keys(), ...supabaseByRef.keys()]);
  for (const ref of allRefs) {
    const sheetList = sheetByRef.get(ref);
    const supabaseList = supabaseByRef.get(ref);

    if (!supabaseList) {
      mismatches.push({ stableRef: ref, category: "MISSING_IN_SUPABASE", detail: `"${ref}" exists in the Sheet but not in Supabase` });
      continue;
    }
    if (!sheetList) {
      mismatches.push({ stableRef: ref, category: "MISSING_IN_SHEET", detail: `"${ref}" exists in Supabase but not in the Sheet` });
      continue;
    }

    const sheetRecord = sheetList[0];
    const supabaseRecord = supabaseList[0];
    let rowHasDiff = false;

    if (sheetRecord.version != null && supabaseRecord.version != null && sheetRecord.version !== supabaseRecord.version) {
      rowHasDiff = true;
      mismatches.push({
        stableRef: ref,
        category: "VERSION_DIFF",
        detail: `version differs: "${sheetRecord.version}" (Sheet) vs "${supabaseRecord.version}" (Supabase)`,
        sheetValue: sheetRecord.version,
        supabaseValue: supabaseRecord.version,
      });
    }

    const fieldKeys = new Set<string>([...Object.keys(sheetRecord.fields), ...Object.keys(supabaseRecord.fields)]);
    for (const key of fieldKeys) {
      const sheetValue = key in sheetRecord.fields ? sheetRecord.fields[key] : null;
      const supabaseValue = key in supabaseRecord.fields ? supabaseRecord.fields[key] : null;
      if (sheetValue !== supabaseValue) {
        rowHasDiff = true;
        mismatches.push({
          stableRef: ref,
          category: "FIELD_DIFF",
          detail: `field "${key}" differs`,
          sheetValue,
          supabaseValue,
        });
      }
    }

    if (!rowHasDiff && !duplicatedRefs.has(ref)) matchedCount += 1;
  }

  return { mismatches, matchedCount, sheetCount: sheetRecords.length, supabaseCount: supabaseRecords.length };
}

function groupByStableRef(records: readonly StableRefRecord[]): Map<string, StableRefRecord[]> {
  const map = new Map<string, StableRefRecord[]>();
  for (const record of records) {
    const list = map.get(record.stableRef) ?? [];
    list.push(record);
    map.set(record.stableRef, list);
  }
  return map;
}

const KNOWN_STABLE_REF_PATTERN = /^(CP|CL|ND|TP|TPI|TT)-/;

/**
 * Best-effort convenience check for the dash-prefixed stable ref families
 * (CP, CL, ND, TP, TPI, TT). Workflow_ID and Step_ID values do not follow a
 * fixed prefix in the source Sheet, so this helper is informational only and
 * must never gate reconciliation itself.
 */
export function looksLikeDashPrefixedStableRef(stableRef: string): boolean {
  return KNOWN_STABLE_REF_PATTERN.test(stableRef);
}
