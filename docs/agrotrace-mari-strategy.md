# Mari for Agrotrace: production strategy

## Goal

Build a domain assistant for Agrotrace users that reliably answers and executes workflows around:

- Propriedades
- Atendimentos
- Questionarios (temas, subtemas, perguntas)
- Safras

The assistant should combine:

- Pi Coding Agent as orchestrator
- MCP tools (`mysql`, `web`) for retrieval/actions
- Strong multi-tenant and permission safety

## What we learned from Agrotrace code

Based on the inspected modules and entities, these are the core relationships to center the assistant on:

- `Atendimento` links `propriedade`, `safra`, `protocolo`, `tecnico`, `produtor` and drives operational timeline (agendamento/execucao/conclusao).
- `QueResposta` links each atendimento to `QuePergunta`, with optional lista/complemento/anexos and IA audit fields.
- `Questionario` is hierarchical (`tema -> subtema -> pergunta`) and has integrity constraints (e.g., duplicate-name checks, delete blocked when responses exist).
- `Safra` is a key scoping dimension and connects to propriedades and atendimentos.
- `Propriedade` is heavily connected (certificadora, filial, safras, atendimentos, geolocation), making it a primary entry point for user questions.

Implication: the best UX is query-first and workflow-aware, not generic chat.

## Recommended agent topology

Start with a **single orchestrator + role prompts** (no hard multi-agent process boundary yet), then split into real subagents only after telemetry shows clear bottlenecks.

### 1) Coordinator (Mari-Core)

Responsibilities:

- Classify intent (consultar, comparar, explicar, executar acao)
- Resolve scope (`certificadoraId`, `usuarioId`, optional `safraId`, `propriedadeId`)
- Choose data plan (which MCP calls, order, limits)
- Merge evidence into final response
- Enforce guardrails (permission, PII/minimization, SQL safety)

### 2) Domain specialists (prompt-level first)

Implement as internal modes first:

- `specialist_propriedades`: profile, status, vínculos, pendências
- `specialist_atendimentos`: agenda, status, histórico, indicadores
- `specialist_questionarios`: estrutura, perguntas, consistência, impacto
- `specialist_safras`: recortes de período, comparativos, tendência

Each specialist returns:

- normalized findings
- confidence
- gaps/questions for coordinator

### 3) Optional execution specialist

Add later for write-actions (when MCP write tools are introduced):

- mutation planning
- dry-run preview
- explicit confirmation flow

## MCP tool design for production

Keep one MCP gateway in Pi (`mcp`) but standardize tool contracts the coordinator can trust.

### Read-focused tools first

- `agrotrace_search_entities` (fast lookup by nome/id/doc)
- `agrotrace_get_propriedade_context`
- `agrotrace_get_atendimento_context`
- `agrotrace_get_questionario_context`
- `agrotrace_get_safra_context`
- `agrotrace_kpi_snapshot` (counts/status aggregates)

### Tool contract rules

- Always require tenant context (`certificadoraId`) and actor context (`usuarioId` where applicable).
- Always paginate/list-limit with deterministic ordering.
- Return compact JSON with:
  - `data`
  - `meta` (filters used, truncation, timing)
  - `warnings` (missing scope, no records, partial results)
- Include provenance in responses (table/entity names or endpoint sources).

## Safety and governance

## Required guardrails

- Tenant isolation by default (never cross-certificadora).
- Permission-aware filtering (reuse same visibility rules as API services where possible).
- Block free-form write SQL in production mode.
- Redact sensitive fields unless explicitly needed.
- Add per-tool timeout and circuit breaker.

## Response policy

- Never invent IDs/statuses.
- If evidence is insufficient, explicitly state missing filters and suggest exact next filter.
- For operational answers, prefer concise table-like summaries (status, data, responsável, propriedade, safra).

## Rollout plan

## Phase 1: domain read assistant (MVP)

- Deliver coordinator + 4 domain specialist modes.
- Add read-only MCP tools for core contexts.
- Support top user asks:
  - "quais atendimentos estão atrasados nesta safra?"
  - "resumo da propriedade X"
  - "quais perguntas geram mais não conformidade?"
  - "comparar safra atual vs anterior"

Success criteria:

- > =90% of sampled answers with verifiable source evidence.
- p95 end-to-end latency under target (define by environment, e.g. <8s).
- Zero cross-tenant leaks.

## Phase 2: guided workflows

- Add workflow templates: follow-up de atendimento, plano de acao, priorização.
- Add saved prompts per persona (técnico, gestor certificadora, analista qualidade).
- Add conversation memory with scoped context (tenant + safra + propriedade).

## Phase 3: safe actions

- Introduce write tools only for low-risk operations first.
- Mandatory dry-run + confirmation + audit trail.
- Add rollback/compensation where applicable.

## Observability and evaluation

Track:

- tool call count and latency by intent
- empty-result rate
- clarification rate
- hallucination proxy (claims without source)
- user correction rate

Create a fixed evaluation set (50-100 real Agrotrace questions) across the four domains and run it on every major prompt/tool change.

## Suggested immediate implementation in `mari`

1. Add a coordinator system prompt focused on Agrotrace scope, filters, and evidence-first behavior.
2. Add domain routing logic (lightweight classifier) before tool planning.
3. Implement 4-6 read MCP tools above with strict input/output schemas.
4. Add response renderer patterns for operational summaries (bullets + compact tables).
5. Add telemetry fields to each response (`intent`, `tools_used`, `source_count`, `confidence`).

This path gives a production-safe assistant quickly, while keeping room to evolve into a true coordinator/subagent architecture only when needed by scale and complexity.
