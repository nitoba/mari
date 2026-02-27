---
name: chart-visualization
description: Generate charts from Agrotrace data for analysis and reporting. Use when users ask for grafico, chart, trend visualization, comparison by status/safra/propriedade, or dashboard visuals.
dependency:
  nodejs: '>=18.0.0'
---

# Chart Visualization Skill

This skill transforms structured Agrotrace results into chart images using `scripts/generate.js`.

For this project, always work in evidence-first mode: query data first, then visualize.

## Workflow

## 1) Collect and normalize data

1. Use Agrotrace tools first (`agrotrace_kpi_snapshot`, `agrotrace_get_*_context`, `agrotrace_search_entities` if needed).
2. Confirm filters applied (`certificadoraId`, `usuarioId`, optional `safraId`, `propriedadeId`).
3. Save normalized data into `./.output/reports/<slug>.json`.

## 2) Select chart type intelligently

Use these defaults (and consult `references/` for exact specs):

- Time series: `generate_line_chart` or `generate_area_chart`.
- Category comparison: `generate_bar_chart` or `generate_column_chart`.
- Part-to-whole: `generate_pie_chart` or `generate_treemap_chart`.
- Flow/relationship: `generate_sankey_chart`, `generate_scatter_chart`, or `generate_venn_chart`.
- Maps: `generate_district_map`, `generate_pin_map`, `generate_path_map`.
- Statistical distribution: `generate_histogram_chart`, `generate_boxplot_chart`, `generate_violin_chart`.

## 3) Build the chart payload

1. Read the matching `references/generate_<chart>.md` file.
2. Map normalized data into the required `args` format.
3. Save payload to `./.output/reports/<slug>-chart-spec.json`.

Payload format:

```json
{
  "tool": "generate_chart_type_name",
  "args": {
    "data": [...],
    "title": "...",
    "theme": "...",
    "style": { ... }
  }
}
```

## 4) Generate chart

```bash
node ./.pi/skills/chart-visualization/scripts/generate.js "./.output/reports/<slug>-chart-spec.json"
```

The script returns a chart URL (or mapped response content for map tools).

## 5) Return to user

Return:

- chart URL/output
- if any local artifact is created under `./.output/reports`, also return:
  - view: `/api/assets?name=<file-name>`
  - download: `/api/assets?name=<file-name>&download=1`
- chart type used
- filters used in data query
- short interpretation in 2-4 bullets

## Project notes

- Never invent values.
- If data is sparse, state limitation before plotting.
- Prefer one clear chart per question unless user requests a dashboard set.
- Keep labels in pt-BR when user writes in pt-BR.

## Reference Material

Detailed schema requirements for each chart tool are in `references/`.
