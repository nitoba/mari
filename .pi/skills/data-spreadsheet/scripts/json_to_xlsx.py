#!/usr/bin/env python3

import argparse
import csv
import json
from pathlib import Path

from openpyxl import Workbook


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output")
    parser.add_argument("--csv")
    parser.add_argument("--sheet", default="dados")
    parser.add_argument("--max-rows", type=int, default=50000)
    return parser.parse_args()


def normalize_rows(payload):
    if isinstance(payload, list):
        return payload

    if isinstance(payload, dict):
        for key in ("items", "rows", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value

    return []


def extract_columns(rows):
    columns = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            if key in seen:
                continue
            seen.add(key)
            columns.append(key)
    return columns


def stringify(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def write_xlsx(rows, columns, output_path: Path, sheet_name: str) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    if worksheet is None:
        raise RuntimeError("Failed to create active worksheet")

    worksheet.title = sheet_name[:31]

    if columns:
        worksheet.append(columns)
        for row in rows:
            if isinstance(row, dict):
                worksheet.append([stringify(row.get(column)) for column in columns])
            else:
                worksheet.append([stringify(row)] + [""] * (len(columns) - 1))
    else:
        worksheet.append(["value"])
        for row in rows:
            worksheet.append([stringify(row)])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(str(output_path))


def write_csv(rows, columns, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)

        if columns:
            writer.writerow(columns)
            for row in rows:
                if isinstance(row, dict):
                    writer.writerow([stringify(row.get(column)) for column in columns])
                else:
                    writer.writerow([stringify(row)] + [""] * (len(columns) - 1))
        else:
            writer.writerow(["value"])
            for row in rows:
                writer.writerow([stringify(row)])


def main() -> None:
    args = parse_args()

    if not args.output and not args.csv:
        raise ValueError("Provide --output and/or --csv")

    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    rows = normalize_rows(payload)[: args.max_rows]
    columns = extract_columns(rows)

    if args.output:
        write_xlsx(rows, columns, Path(args.output), args.sheet)

    if args.csv:
        write_csv(rows, columns, Path(args.csv))


if __name__ == "__main__":
    main()
