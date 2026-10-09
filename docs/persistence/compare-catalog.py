#!/usr/bin/env python3
"""Classify live-catalog.txt against repo-catalog-baseline.txt.

Both files are the psql output of docs/persistence/live-catalog-audit.sql.
Every row is keyed by its identity columns (e.g. table + constraint name):

  MATCH            same key, byte-identical row
  DIFF             same key, any other column differs (both rows printed)
  MISSING_IN_LIVE  key only in the repo baseline
  EXTRA_IN_LIVE    key only in live
  UNKNOWN          a whole section is absent from one side (e.g. the query
                   failed or was not run), so nothing about it is claimed

Nothing is normalized beyond trimming psql's cell padding: whitespace inside
a value, casing, ordering of array elements etc. all count as differences.

Usage: compare-catalog.py repo-catalog-baseline.txt live-catalog.txt
"""
import sys
from collections import OrderedDict

# Section title -> indexes of the identity columns in that section's rows.
KEYS = OrderedDict([
    ("tables in scope", [0]),
    ("columns", [0, 2]),
    ("constraints (PK / FK / UNIQUE / CHECK) with exact names, definitions and FK actions", [0, 1]),
    ("indexes (incl. partial predicates)", [0, 1]),
    ("triggers", [0, 1, 3]),
    ("functions (public + private): signature, security, search_path, volatility", [0, 1, 2]),
    ("table grants", [0, 1]),
    ("routine grants", [0, 1, 2, 3]),
    ("schema privileges", [0, 1]),
    ("RLS policies", [0, 1, 2]),
    ("default privileges", [0, 1, 2]),
    ("applied migration history (Supabase CLI ledger, if present)", [0]),
])


def parse(path):
    sections, current, header_seen = {}, None, False
    pending = ""
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            if line.startswith("== "):
                current, header_seen = line[3:].strip(), False
                sections[current] = {"rows": [], "notes": []}
                continue
            if current is None or not line.strip():
                continue
            if set(line.strip()) <= set("-+"):
                header_seen = True  # the ---+--- rule under the column header
                continue
            if line.strip().startswith("(") and line.strip().endswith(("row)", "rows)")):
                continue
            if not header_seen:
                if "|" not in line:
                    sections[current]["notes"].append(line.strip())
                continue  # column header line
            # psql marks a wrapped multi-line cell with a trailing "+".
            if line.endswith("+"):
                pending += line[:-1].rstrip() + "\\n"
                continue
            line, pending = pending + line, ""
            cells = [cell.strip() for cell in line.split("|")]
            sections[current]["rows"].append(cells)
    return sections


def classify(base_path, live_path):
    base, live = parse(base_path), parse(live_path)
    totals = {"MATCH": 0, "DIFF": 0, "MISSING_IN_LIVE": 0, "EXTRA_IN_LIVE": 0, "UNKNOWN": 0}
    for title, key_cols in KEYS.items():
        print(f"\n### {title}")
        if title not in base or title not in live:
            side = "repo baseline" if title not in base else "live"
            print(f"UNKNOWN  section absent from {side} output")
            totals["UNKNOWN"] += 1
            continue
        for note in base[title]["notes"] + live[title]["notes"]:
            print(f"NOTE     {note}")

        def index(rows):
            out = OrderedDict()
            for cells in rows:
                key = tuple(cells[i] if i < len(cells) else "" for i in key_cols)
                out.setdefault(key, []).append(cells)
            return out

        b, l = index(base[title]["rows"]), index(live[title]["rows"])
        for key in list(b.keys()) + [k for k in l.keys() if k not in b]:
            label = " | ".join(key)
            if key not in l:
                verdict = "MISSING_IN_LIVE"
                print(f"{verdict:<16} {label}")
            elif key not in b:
                verdict = "EXTRA_IN_LIVE"
                print(f"{verdict:<16} {label}  ::  {' | '.join(l[key][0])}")
            elif sorted(b[key]) == sorted(l[key]):
                verdict = "MATCH"
            else:
                verdict = "DIFF"
                print(f"{verdict:<16} {label}")
                for row in b[key]:
                    print(f"    repo: {' | '.join(row)}")
                for row in l[key]:
                    print(f"    live: {' | '.join(row)}")
            totals[verdict] += 1
        matched = sum(1 for k in b if k in l and sorted(b[k]) == sorted(l[k]))
        print(f"MATCH    {matched} row(s)")
    print("\n### TOTALS")
    for verdict, count in totals.items():
        print(f"{verdict:<16} {count}")
    return totals


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    result = classify(sys.argv[1], sys.argv[2])
    sys.exit(0 if result["DIFF"] == result["MISSING_IN_LIVE"] == result["EXTRA_IN_LIVE"] == result["UNKNOWN"] == 0 else 1)
