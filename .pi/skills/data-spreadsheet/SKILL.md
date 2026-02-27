---
name: data-spreadsheet
description: Create or update spreadsheet files from Agrotrace data. Use when the user asks for Excel, XLSX, CSV, planilha, tabular export, or data manipulation in sheets.
---

# Data Spreadsheet

Use this skill to turn query results into spreadsheet artifacts.

## Workflow

1. Collect and normalize data from Agrotrace tools.
2. Save JSON to `./.output/reports/<slug>.json`.
3. Generate `.xlsx` with:

```bash
python3 ".pi/skills/data-spreadsheet/scripts/json_to_xlsx.py" --input "./.output/reports/<slug>.json" --output "./.output/reports/<slug>.xlsx" --sheet "dados"
```

4. If the user asked for CSV, also emit:

```bash
python3 ".pi/skills/data-spreadsheet/scripts/json_to_xlsx.py" --input "./.output/reports/<slug>.json" --csv "./.output/reports/<slug>.csv"
```

5. Return:
   - output files
   - access links using API endpoint:
     - view (csv/txt/html): `/api/assets?name=<file-name>`
     - download: `/api/assets?name=<file-name>&download=1`
   - columns used
   - row count

## Notes

- Use compact and business-friendly column names.
- Keep IDs and date columns for traceability.
- If dependency is missing, install once:

```bash
python3 -m pip install --user openpyxl
```
