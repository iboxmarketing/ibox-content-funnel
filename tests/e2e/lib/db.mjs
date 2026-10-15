/** LOCAL E2E ONLY: read the disposable database directly (verification, never via the app). */
import { execFileSync } from "node:child_process";

const CONTAINER = process.env.PG_CONTAINER ?? "ibox-pg-dryrun";
const DB = process.env.E2E_DB ?? "e2e";

export function sql(query) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-tAqX"], { input: query, encoding: "utf8" }).trim();
}

/** Rows of a SELECT as plain objects. */
export function rows(query) {
  const out = sql(`select coalesce(json_agg(t), '[]') from (${query}) t`);
  return JSON.parse(out);
}

export const ids = {
  head: "00000000-0000-4000-8000-00000000e001",
  author: "00000000-0000-4000-8000-00000000e002",
  reviewer: "00000000-0000-4000-8000-00000000e003",
  other: "00000000-0000-4000-8000-00000000e004",
  former: "00000000-0000-4000-8000-00000000e005",
  node: "00000000-0000-4000-8000-0000000c0004",
};
