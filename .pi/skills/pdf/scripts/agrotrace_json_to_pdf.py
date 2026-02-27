#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--title", default="Data report")
    parser.add_argument("--max-rows", type=int, default=200)
    return parser.parse_args()


def normalize_rows(payload):
    if isinstance(payload, list):
        return payload

    if isinstance(payload, dict):
        for key in ("items", "rows", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return value

        flattened = []
        for key in ("snapshot", "totals"):
            value = payload.get(key)
            if isinstance(value, dict):
                flattened.append(
                    {"metric": key, "value": json.dumps(value, ensure_ascii=False)}
                )
        if flattened:
            return flattened

    return []


def stringify(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def build_table(rows, max_rows):
    if not rows:
        return [["message"], ["No rows available in input data"]]

    keys = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            if key in seen:
                continue
            seen.add(key)
            keys.append(key)

    if not keys:
        return [["value"], [stringify(item) for item in rows[:max_rows]]]

    table_data = [keys]
    for row in rows[:max_rows]:
        if not isinstance(row, dict):
            table_data.append([stringify(row)] + [""] * (len(keys) - 1))
            continue
        table_data.append([stringify(row.get(key)) for key in keys])

    return table_data


def main() -> None:
    args = parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    rows = normalize_rows(payload)
    table_data = build_table(rows, args.max_rows)

    doc = SimpleDocTemplate(str(output_path), pagesize=A4)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph(args.title, styles["Title"]))
    story.append(Spacer(1, 8))
    story.append(Paragraph(f"Rows: {len(rows)}", styles["Normal"]))
    story.append(Spacer(1, 12))

    table = Table(table_data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2f5f1c")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [colors.white, colors.HexColor("#f7f7f7")],
                ),
            ]
        )
    )
    story.append(table)

    doc.build(story)


if __name__ == "__main__":
    main()
