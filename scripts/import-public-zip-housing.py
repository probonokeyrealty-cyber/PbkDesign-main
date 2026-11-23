"""Build the reviewed ACS/FHFA snapshot from local, pinned agency downloads."""

import argparse
import csv
from decimal import Decimal
from hashlib import file_digest
import json
from math import isfinite
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/app/data/public-zip-housing.json"
INPUT_DIGESTS = {
    "b25064.dat": "b36e6dc1fcef36b8b307d31b37517b64c80d8b9c70d48c9b1894242860f42eb0",
    "b25077.dat": "89eb2153764a2330b23959d8bbc29b3a8f3016f087b990f2a8ea0d5096d9a816",
    "hpi_at_zip5.xlsx": "3d3da1123aea4222fef213cef8fe5a72b49d1f0067c72a314adb079305631cbd",
}


def read_acs(path, table):
    estimate, margin = f"{table}_E001", f"{table}_M001"
    found = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source, delimiter="|")
        if rows.fieldnames != ["GEO_ID", estimate, margin]:
            raise ValueError(f"Unexpected ACS columns in {path.name}")
        for row in rows:
            match = re.fullmatch(r"860Z200US([0-9]{5})", row["GEO_ID"])
            if not match:
                continue
            code = match[1]
            if code in found:
                raise ValueError(f"Duplicate {table} ZCTA {code}")
            value, moe = int(row[estimate]), int(row[margin])
            # Negative sentinels include missing and open-ended (top-coded) medians.
            found[code] = (value, moe) if value > 0 and moe >= 0 else None
    return {code: value for code, value in found.items() if value is not None}


def read_fhfa(path):
    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = workbook["ZIP5"]
        if sheet["A4"].value != "Last updated: March 31, 2026.":
            raise ValueError("Unexpected FHFA workbook vintage")
        rows = sheet.iter_rows(min_row=6, max_col=4, values_only=True)
        if next(rows) != ("Five-Digit ZIP Code", "Year", "Annual Change (%)", "HPI"):
            raise ValueError("Unexpected FHFA columns")
        found = {}
        seen = set()
        for code, year, change, index in rows:
            if type(code) is int and 0 < code <= 99999:
                code = f"{code:05d}"
            if year not in (2024, 2025) or not isinstance(code, str) or not re.fullmatch(r"[0-9]{5}", code):
                continue
            if (code, year) in seen:
                raise ValueError(f"Duplicate FHFA ZIP {code} for {year}")
            seen.add((code, year))
            if (
                type(change) in (int, float) and isfinite(change) and change > -100
                and type(index) in (int, float) and isfinite(index) and index > 0
                and (code not in found or year > found[code][0])
            ):
                basis_points = int((Decimal(str(change)) * 100).quantize(Decimal("1")))
                found[code] = (year, basis_points)
        return found
    finally:
        workbook.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_directory", type=Path)
    args = parser.parse_args()
    inputs = args.input_directory
    for name, expected in INPUT_DIGESTS.items():
        with (inputs / name).open("rb") as source:
            if file_digest(source, "sha256").hexdigest() != expected:
                raise ValueError(f"Unreviewed source file: {name}")

    rent = read_acs(inputs / "b25064.dat", "B25064")
    value = read_acs(inputs / "b25077.dat", "B25077")
    hpi = read_fhfa(inputs / "hpi_at_zip5.xlsx")
    if not all((rent, value, hpi)):
        raise ValueError("At least one source has no usable observations")
    codes = sorted(rent.keys() | value.keys() | hpi.keys())
    rows = [
        json.dumps(code) + ":" + json.dumps(
            [rent.get(code), value.get(code), hpi.get(code)], separators=(",", ":"),
        )
        for code in codes
    ]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("{\n" + ",\n".join(rows) + "\n}\n", encoding="utf-8", newline="\n")
    print(f"{len(codes):,} codes: {len(rent):,} ACS rents, {len(value):,} ACS values, {len(hpi):,} FHFA changes")


if __name__ == "__main__":
    main()
