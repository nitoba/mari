import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import type { McpToolExecutionResult } from '@/lib/pi-agent/mcp/types'
import { getPiMcpManager } from '@/lib/pi-agent/mcp/manager'

type AgrotraceEntityType =
  | 'all'
  | 'propriedade'
  | 'atendimento'
  | 'questionario'
  | 'safra'

type TableKey =
  | 'propriedade'
  | 'atendimento'
  | 'questionario'
  | 'safra'
  | 'pessoa'
  | 'protocolo'
  | 'que_tema'
  | 'que_subtema'
  | 'que_pergunta'
  | 'que_resposta'
  | 'certificadora_propriedade'
  | 'certificadora_protocolo'
  | 'safra_propriedade'

type ResolvedTables = Record<TableKey, string>

type ProvenanceEntry = {
  server: 'mysql'
  tool: string
  purpose: string
  queryName?: string
}

type SearchToolParams = {
  query: string
  certificadoraId: number
  usuarioId?: number
  entityType: AgrotraceEntityType
  safraId?: number
  limit: number
}

type AtendimentoContextParams = {
  certificadoraId: number
  atendimentoId?: number
  propriedadeId?: number
  safraId?: number
  statusId?: number
  usuarioId?: number
  includeResponseStats: boolean
  limit: number
}

type PropriedadeContextParams = {
  certificadoraId: number
  propriedadeId?: number
  safraId?: number
  usuarioId?: number
  includeAtendimentoStats: boolean
  limit: number
}

type QuestionarioContextParams = {
  certificadoraId: number
  questionarioId?: number
  protocoloId?: number
  safraId?: number
  usuarioId?: number
  includeResponseStats: boolean
  limit: number
}

type KpiSnapshotParams = {
  certificadoraId: number
  safraId?: number
  propriedadeId?: number
  usuarioId?: number
  fromDate?: string
  toDate?: string
}

type SearchItem = {
  entityType: Exclude<AgrotraceEntityType, 'all'>
  id: number
  label: string
  subtitle?: string
  statusId?: number
  safraId?: number
  propriedadeId?: number
  dataReferencia?: string
  matchScore: number
}

type TableResolutionCache = {
  expiresAt: number
  resolvedTables: ResolvedTables
  missingCanonicalTables: Array<TableKey>
}

const TOOL_TABLE_CACHE_TTL_MS = 5 * 60_000

const DEFAULT_TABLES: ResolvedTables = {
  propriedade: 'propriedade',
  atendimento: 'atendimento',
  questionario: 'questionario',
  safra: 'safra',
  pessoa: 'pessoa',
  protocolo: 'protocolo',
  que_tema: 'que_tema',
  que_subtema: 'que_subtema',
  que_pergunta: 'que_pergunta',
  que_resposta: 'que_resposta',
  certificadora_propriedade: 'certificadora_propriedade',
  certificadora_protocolo: 'certificadora_protocolo',
  safra_propriedade: 'safra_propriedade',
}

let tableResolutionCache: TableResolutionCache | undefined

const SEARCH_PARAMETERS = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        'Termo opcional de busca por nome/id. Use "*" para busca ampla no tenant.',
    }),
  ),
  certificadoraId: Type.Integer({
    minimum: 1,
    description: 'Tenant id obrigatorio para isolamento de dados.',
  }),
  usuarioId: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        'Usuario opcional para aplicar recorte de permissao por propriedade.',
    }),
  ),
  entityType: Type.Optional(
    Type.Union([
      Type.Literal('all'),
      Type.Literal('propriedade'),
      Type.Literal('atendimento'),
      Type.Literal('questionario'),
      Type.Literal('safra'),
    ]),
  ),
  safraId: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Filtro opcional de safra para refinar resultados.',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 50,
      description: 'Limite maximo de resultados (1-50). Default 20.',
    }),
  ),
})

const ATENDIMENTO_CONTEXT_PARAMETERS = Type.Object({
  certificadoraId: Type.Integer({
    minimum: 1,
    description: 'Tenant id obrigatorio para isolamento de dados.',
  }),
  atendimentoId: Type.Optional(Type.Integer({ minimum: 1 })),
  propriedadeId: Type.Optional(Type.Integer({ minimum: 1 })),
  safraId: Type.Optional(Type.Integer({ minimum: 1 })),
  statusId: Type.Optional(Type.Integer({ minimum: 1 })),
  usuarioId: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Usuario para aplicar recorte de permissao por propriedade.',
    }),
  ),
  includeResponseStats: Type.Optional(
    Type.Boolean({
      description: 'Se true, agrega total de respostas por atendimento.',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 50,
      description: 'Limite maximo de atendimentos retornados. Default 20.',
    }),
  ),
})

const PROPRIEDADE_CONTEXT_PARAMETERS = Type.Object({
  certificadoraId: Type.Integer({
    minimum: 1,
    description: 'Tenant id obrigatorio para isolamento de dados.',
  }),
  propriedadeId: Type.Optional(Type.Integer({ minimum: 1 })),
  safraId: Type.Optional(Type.Integer({ minimum: 1 })),
  usuarioId: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Usuario para aplicar recorte de permissao por propriedade.',
    }),
  ),
  includeAtendimentoStats: Type.Optional(
    Type.Boolean({
      description:
        'Se true, agrega totais de atendimentos e respostas por propriedade.',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 50,
      description: 'Limite maximo de propriedades retornadas. Default 20.',
    }),
  ),
})

const QUESTIONARIO_CONTEXT_PARAMETERS = Type.Object({
  certificadoraId: Type.Integer({
    minimum: 1,
    description: 'Tenant id obrigatorio para isolamento de dados.',
  }),
  questionarioId: Type.Optional(Type.Integer({ minimum: 1 })),
  protocoloId: Type.Optional(Type.Integer({ minimum: 1 })),
  safraId: Type.Optional(Type.Integer({ minimum: 1 })),
  usuarioId: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        'Usuario para aplicar recorte de permissao por propriedade nos indicadores de respostas.',
    }),
  ),
  includeResponseStats: Type.Optional(
    Type.Boolean({
      description:
        'Se true, agrega respostas, atendimentos e pendencias IA por questionario.',
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 50,
      description: 'Limite maximo de questionarios retornados. Default 20.',
    }),
  ),
})

const KPI_SNAPSHOT_PARAMETERS = Type.Object({
  certificadoraId: Type.Integer({
    minimum: 1,
    description: 'Tenant id obrigatorio para isolamento de dados.',
  }),
  safraId: Type.Optional(Type.Integer({ minimum: 1 })),
  propriedadeId: Type.Optional(Type.Integer({ minimum: 1 })),
  usuarioId: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Usuario para aplicar recorte de permissao por propriedade.',
    }),
  ),
  fromDate: Type.Optional(
    Type.String({
      description: 'Data inicial YYYY-MM-DD aplicada ao eixo temporal.',
    }),
  ),
  toDate: Type.Optional(
    Type.String({
      description: 'Data final YYYY-MM-DD aplicada ao eixo temporal.',
    }),
  ),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmedValue = value.trim()
  return trimmedValue || undefined
}

const getParamValue = (
  params: Record<string, unknown>,
  aliases: Array<string>,
): unknown => {
  for (const alias of aliases) {
    if (alias in params) {
      return params[alias]
    }
  }

  return undefined
}

const toOptionalPositiveInteger = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) return undefined
    return value
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim()
    if (!trimmedValue) return undefined
    const parsedValue = Number(trimmedValue)
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) return undefined
    return parsedValue
  }

  return undefined
}

const toRequiredPositiveInteger = (
  value: unknown,
  fieldName: string,
): number => {
  const parsedValue = toOptionalPositiveInteger(value)
  if (parsedValue === undefined) {
    throw new Error(
      `Missing or invalid ${fieldName}. Expected positive integer.`,
    )
  }

  return parsedValue
}

const clampLimit = (value: unknown, fallback = 20): number => {
  const parsedValue = toOptionalPositiveInteger(value)
  if (parsedValue === undefined) return fallback
  return Math.min(50, Math.max(1, parsedValue))
}

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

const getResultText = (result: McpToolExecutionResult): string =>
  result.content
    .filter(
      (contentPart): contentPart is { type: 'text'; text: string } =>
        contentPart.type === 'text',
    )
    .map((contentPart) => contentPart.text)
    .join('\n')
    .trim()

const parseJsonText = (value: string): unknown => {
  if (!value) return undefined

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const resultToRows = (
  result: McpToolExecutionResult,
): Array<Record<string, unknown>> => {
  const parsedResult = parseJsonText(getResultText(result))

  if (Array.isArray(parsedResult)) {
    return parsedResult.filter((row): row is Record<string, unknown> =>
      isRecord(row),
    )
  }

  if (isRecord(parsedResult)) {
    return [parsedResult]
  }

  return []
}

const resultToFirstRow = (
  result: McpToolExecutionResult,
): Record<string, unknown> => resultToRows(result)[0] ?? {}

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    return value
  }

  if (typeof value === 'string') {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) return undefined
    return parsedValue
  }

  return undefined
}

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmedValue = value.trim()
  return trimmedValue || undefined
}

const toInClause = (values: Array<number>): string =>
  values.map(() => '?').join(', ')

const normalizeForMatch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const callMysqlTool = async (
  toolName: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  provenance: Array<ProvenanceEntry>,
  purpose: string,
  queryName?: string,
): Promise<McpToolExecutionResult> => {
  const manager = getPiMcpManager()

  provenance.push({
    server: 'mysql',
    tool: toolName,
    purpose,
    queryName,
  })

  return await manager.callTool(toolName, args, {
    serverName: 'mysql',
    signal,
  })
}

const resolveTableName = (
  tableNames: Set<string>,
  canonicalName: string,
): string => {
  if (tableNames.has(canonicalName)) return canonicalName

  const prefixedName = `ad_${canonicalName}`
  if (tableNames.has(prefixedName)) return prefixedName

  return canonicalName
}

const getResolvedTables = async (
  signal: AbortSignal | undefined,
  provenance: Array<ProvenanceEntry>,
): Promise<{
  resolvedTables: ResolvedTables
  missingCanonicalTables: Array<TableKey>
}> => {
  const now = Date.now()
  if (tableResolutionCache && tableResolutionCache.expiresAt > now) {
    return {
      resolvedTables: tableResolutionCache.resolvedTables,
      missingCanonicalTables: tableResolutionCache.missingCanonicalTables,
    }
  }

  const configuredDatabase = normalizeString(process.env.AGROTRACE_DATABASE)
  const listTablesArgs = configuredDatabase
    ? { database: configuredDatabase }
    : {}

  const listTablesResult = await callMysqlTool(
    'mysql_list_tables',
    listTablesArgs,
    signal,
    provenance,
    'discover agrotrace table names',
    'table_discovery',
  )

  const tableRows = resultToRows(listTablesResult)
  const tableNames = new Set<string>()

  for (const row of tableRows) {
    const tableName = normalizeString(row.table_name)
    if (!tableName) continue
    tableNames.add(tableName)
  }

  const resolvedTables: ResolvedTables = {
    propriedade: resolveTableName(tableNames, 'propriedade'),
    atendimento: resolveTableName(tableNames, 'atendimento'),
    questionario: resolveTableName(tableNames, 'questionario'),
    safra: resolveTableName(tableNames, 'safra'),
    pessoa: resolveTableName(tableNames, 'pessoa'),
    protocolo: resolveTableName(tableNames, 'protocolo'),
    que_tema: resolveTableName(tableNames, 'que_tema'),
    que_subtema: resolveTableName(tableNames, 'que_subtema'),
    que_pergunta: resolveTableName(tableNames, 'que_pergunta'),
    que_resposta: resolveTableName(tableNames, 'que_resposta'),
    certificadora_propriedade: resolveTableName(
      tableNames,
      'certificadora_propriedade',
    ),
    certificadora_protocolo: resolveTableName(
      tableNames,
      'certificadora_protocolo',
    ),
    safra_propriedade: resolveTableName(tableNames, 'safra_propriedade'),
  }

  const missingCanonicalTables = (
    Object.keys(DEFAULT_TABLES) as Array<TableKey>
  ).filter((tableKey) => !tableNames.has(resolvedTables[tableKey]))

  tableResolutionCache = {
    expiresAt: now + TOOL_TABLE_CACHE_TTL_MS,
    resolvedTables,
    missingCanonicalTables,
  }

  return {
    resolvedTables,
    missingCanonicalTables,
  }
}

const buildToolResult = (
  summaryText: string,
  details: Record<string, unknown>,
): {
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
} => ({
  content: [{ type: 'text', text: summaryText }],
  details,
})

const normalizeSearchParams = (params: unknown): SearchToolParams => {
  if (!isRecord(params)) {
    throw new Error('Invalid parameters for agrotrace_search_entities.')
  }

  const rawQuery = normalizeString(params.query)
  const query = rawQuery ?? '*'

  if (query !== '*' && query.length < 2) {
    throw new Error('query must have at least 2 characters or be omitted.')
  }

  const rawEntityType = normalizeString(params.entityType)
  const entityType: AgrotraceEntityType =
    rawEntityType === 'propriedade' ||
    rawEntityType === 'atendimento' ||
    rawEntityType === 'questionario' ||
    rawEntityType === 'safra' ||
    rawEntityType === 'all'
      ? rawEntityType
      : 'all'

  return {
    query,
    certificadoraId: toRequiredPositiveInteger(
      getParamValue(params, [
        'certificadoraId',
        'certificadora_id',
        'tenantId',
        'tenant_id',
      ]),
      'certificadoraId',
    ),
    usuarioId: toOptionalPositiveInteger(
      getParamValue(params, ['usuarioId', 'usuario_id']),
    ),
    entityType,
    safraId: toOptionalPositiveInteger(
      getParamValue(params, ['safraId', 'safra_id']),
    ),
    limit: clampLimit(params.limit, 20),
  }
}

const normalizeAtendimentoContextParams = (
  params: unknown,
): AtendimentoContextParams => {
  if (!isRecord(params)) {
    throw new Error('Invalid parameters for agrotrace_get_atendimento_context.')
  }

  return {
    certificadoraId: toRequiredPositiveInteger(
      getParamValue(params, [
        'certificadoraId',
        'certificadora_id',
        'tenantId',
        'tenant_id',
      ]),
      'certificadoraId',
    ),
    atendimentoId: toOptionalPositiveInteger(
      getParamValue(params, ['atendimentoId', 'atendimento_id']),
    ),
    propriedadeId: toOptionalPositiveInteger(
      getParamValue(params, ['propriedadeId', 'propriedade_id']),
    ),
    safraId: toOptionalPositiveInteger(
      getParamValue(params, ['safraId', 'safra_id']),
    ),
    statusId: toOptionalPositiveInteger(
      getParamValue(params, ['statusId', 'status_id']),
    ),
    usuarioId: toOptionalPositiveInteger(
      getParamValue(params, ['usuarioId', 'usuario_id']),
    ),
    includeResponseStats: params.includeResponseStats !== false,
    limit: clampLimit(params.limit, 20),
  }
}

const normalizePropriedadeContextParams = (
  params: unknown,
): PropriedadeContextParams => {
  if (!isRecord(params)) {
    throw new Error('Invalid parameters for agrotrace_get_propriedade_context.')
  }

  return {
    certificadoraId: toRequiredPositiveInteger(
      getParamValue(params, [
        'certificadoraId',
        'certificadora_id',
        'tenantId',
        'tenant_id',
      ]),
      'certificadoraId',
    ),
    propriedadeId: toOptionalPositiveInteger(
      getParamValue(params, ['propriedadeId', 'propriedade_id']),
    ),
    safraId: toOptionalPositiveInteger(
      getParamValue(params, ['safraId', 'safra_id']),
    ),
    usuarioId: toOptionalPositiveInteger(
      getParamValue(params, ['usuarioId', 'usuario_id']),
    ),
    includeAtendimentoStats: params.includeAtendimentoStats !== false,
    limit: clampLimit(params.limit, 20),
  }
}

const normalizeQuestionarioContextParams = (
  params: unknown,
): QuestionarioContextParams => {
  if (!isRecord(params)) {
    throw new Error(
      'Invalid parameters for agrotrace_get_questionario_context.',
    )
  }

  return {
    certificadoraId: toRequiredPositiveInteger(
      getParamValue(params, [
        'certificadoraId',
        'certificadora_id',
        'tenantId',
        'tenant_id',
      ]),
      'certificadoraId',
    ),
    questionarioId: toOptionalPositiveInteger(
      getParamValue(params, ['questionarioId', 'questionario_id']),
    ),
    protocoloId: toOptionalPositiveInteger(
      getParamValue(params, ['protocoloId', 'protocolo_id']),
    ),
    safraId: toOptionalPositiveInteger(
      getParamValue(params, ['safraId', 'safra_id']),
    ),
    usuarioId: toOptionalPositiveInteger(
      getParamValue(params, ['usuarioId', 'usuario_id']),
    ),
    includeResponseStats: params.includeResponseStats !== false,
    limit: clampLimit(params.limit, 20),
  }
}

const normalizeKpiSnapshotParams = (params: unknown): KpiSnapshotParams => {
  if (!isRecord(params)) {
    throw new Error('Invalid parameters for agrotrace_kpi_snapshot.')
  }

  const fromDate = normalizeString(
    getParamValue(params, ['fromDate', 'from_date']),
  )
  const toDate = normalizeString(getParamValue(params, ['toDate', 'to_date']))

  if (fromDate && !isIsoDate(fromDate)) {
    throw new Error('fromDate must be in YYYY-MM-DD format.')
  }

  if (toDate && !isIsoDate(toDate)) {
    throw new Error('toDate must be in YYYY-MM-DD format.')
  }

  return {
    certificadoraId: toRequiredPositiveInteger(
      getParamValue(params, [
        'certificadoraId',
        'certificadora_id',
        'tenantId',
        'tenant_id',
      ]),
      'certificadoraId',
    ),
    safraId: toOptionalPositiveInteger(
      getParamValue(params, ['safraId', 'safra_id']),
    ),
    propriedadeId: toOptionalPositiveInteger(
      getParamValue(params, ['propriedadeId', 'propriedade_id']),
    ),
    usuarioId: toOptionalPositiveInteger(
      getParamValue(params, ['usuarioId', 'usuario_id']),
    ),
    fromDate,
    toDate,
  }
}

const computeMatchScore = (item: SearchItem, query: string): number => {
  const normalizedQuery = normalizeForMatch(query)
  const normalizedLabel = normalizeForMatch(item.label)

  if (String(item.id) === query.trim()) return 100
  if (normalizedLabel === normalizedQuery) return 90
  if (normalizedLabel.startsWith(normalizedQuery)) return 70
  if (normalizedLabel.includes(normalizedQuery)) return 50
  return 10
}

const parseSearchItems = (
  rows: Array<Record<string, unknown>>,
  query: string,
): Array<SearchItem> => {
  const parsedItems: Array<SearchItem> = []

  for (const row of rows) {
    const id = toNumber(row.id)
    const entityType = normalizeString(row.entityType)

    if (!id) continue
    if (
      entityType !== 'propriedade' &&
      entityType !== 'atendimento' &&
      entityType !== 'questionario' &&
      entityType !== 'safra'
    ) {
      continue
    }

    const label = toOptionalString(row.label) ?? `${entityType} #${id}`
    const item: SearchItem = {
      entityType,
      id,
      label,
      subtitle: toOptionalString(row.subtitle),
      statusId: toNumber(row.statusId),
      safraId: toNumber(row.safraId),
      propriedadeId: toNumber(row.propriedadeId),
      dataReferencia: toOptionalString(row.dataReferencia),
      matchScore: 0,
    }

    item.matchScore = computeMatchScore(item, query)
    parsedItems.push(item)
  }

  return parsedItems
}

type SearchQueryPlan = {
  name: string
  entityType: Exclude<AgrotraceEntityType, 'all'>
  dataQuery: string
  dataParams: Array<unknown>
  countQuery: string
  countParams: Array<unknown>
}

const isBroadSearchQuery = (query: string): boolean => {
  const normalizedQuery = normalizeForMatch(query)
  return (
    normalizedQuery === '' ||
    normalizedQuery === '*' ||
    normalizedQuery === 'all' ||
    normalizedQuery === 'todos' ||
    normalizedQuery === 'todas'
  )
}

const buildSearchQueries = (
  params: SearchToolParams,
  tables: ResolvedTables,
): Array<SearchQueryPlan> => {
  const isBroadSearch = isBroadSearchQuery(params.query)
  const queryAsLike = `%${params.query.toLowerCase()}%`
  const queryAsExact = params.query.trim()
  const entityLimit =
    params.entityType === 'all'
      ? Math.max(8, Math.ceil(params.limit / 2))
      : params.limit

  const propriedadeWhere = ['cp.certificadora_id = ?']
  const propriedadeParams: Array<unknown> = [params.certificadoraId]

  if (!isBroadSearch) {
    propriedadeWhere.push('(LOWER(p.nome) LIKE ? OR CAST(p.id AS CHAR) = ?)')
    propriedadeParams.push(queryAsLike, queryAsExact)
  }

  if (params.safraId) {
    propriedadeWhere.push('sp.safra_id = ?')
    propriedadeParams.push(params.safraId)
  }

  if (params.usuarioId) {
    propriedadeWhere.push(
      'FIND_IN_SET(cp.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))',
    )
    propriedadeParams.push(params.certificadoraId, params.usuarioId)
  }

  const propriedadeCountParams = [...propriedadeParams]
  const propriedadeDataParams = [...propriedadeParams, entityLimit]

  const atendimentoWhere = ['a.certificadora_id = ?']
  const atendimentoParams: Array<unknown> = [params.certificadoraId]

  if (!isBroadSearch) {
    atendimentoWhere.push(
      "(CAST(a.id AS CHAR) = ? OR CAST(a.propriedade_id AS CHAR) = ? OR LOWER(COALESCE(p.nome, '')) LIKE ?)",
    )
    atendimentoParams.push(queryAsExact, queryAsExact, queryAsLike)
  }

  if (params.safraId) {
    atendimentoWhere.push('a.safra_id = ?')
    atendimentoParams.push(params.safraId)
  }

  if (params.usuarioId) {
    atendimentoWhere.push(
      'FIND_IN_SET(a.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))',
    )
    atendimentoParams.push(params.certificadoraId, params.usuarioId)
  }

  const atendimentoCountParams = [...atendimentoParams]
  const atendimentoDataParams = [...atendimentoParams, entityLimit]

  const questionarioWhere = ['cpr.certificadora_id = ?']
  const questionarioParams: Array<unknown> = [params.certificadoraId]

  if (!isBroadSearch) {
    questionarioWhere.push('(LOWER(q.nome) LIKE ? OR CAST(q.id AS CHAR) = ?)')
    questionarioParams.push(queryAsLike, queryAsExact)
  }

  const questionarioCountParams = [...questionarioParams]
  const questionarioDataParams = [...questionarioParams, entityLimit]

  const safraWhere = ['s.certificadora_id = ?']
  const safraParams: Array<unknown> = [params.certificadoraId]

  if (!isBroadSearch) {
    safraWhere.push('(LOWER(s.nome) LIKE ? OR CAST(s.id AS CHAR) = ?)')
    safraParams.push(queryAsLike, queryAsExact)
  }

  if (params.safraId) {
    safraWhere.push('s.id = ?')
    safraParams.push(params.safraId)
  }

  if (params.usuarioId) {
    safraWhere.push(
      `EXISTS (
        SELECT 1
        FROM ${tables.safra_propriedade} sp_scope
        WHERE sp_scope.safra_id = s.id
          AND FIND_IN_SET(sp_scope.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))
      )`,
    )
    safraParams.push(params.certificadoraId, params.usuarioId)
  }

  const safraCountParams = [...safraParams]
  const safraDataParams = [...safraParams, entityLimit]

  const queries: Record<
    Exclude<AgrotraceEntityType, 'all'>,
    SearchQueryPlan
  > = {
    propriedade: {
      entityType: 'propriedade',
      name: 'search_propriedade',
      dataQuery: `
        SELECT DISTINCT
          'propriedade' AS entityType,
          p.id AS id,
          p.nome AS label,
          CONCAT('Produtor ', COALESCE(CAST(p.produtor_id AS CHAR), '-')) AS subtitle,
          NULL AS statusId,
          NULL AS safraId,
          p.id AS propriedadeId,
          NULL AS dataReferencia
        FROM ${tables.propriedade} p
        INNER JOIN ${tables.certificadora_propriedade} cp ON cp.propriedade_id = p.id
        LEFT JOIN ${tables.safra_propriedade} sp ON sp.propriedade_id = p.id
        WHERE ${propriedadeWhere.join(' AND ')}
        ORDER BY p.nome ASC
        LIMIT ?
      `.trim(),
      dataParams: propriedadeDataParams,
      countQuery: `
        SELECT COUNT(DISTINCT p.id) AS total
        FROM ${tables.propriedade} p
        INNER JOIN ${tables.certificadora_propriedade} cp ON cp.propriedade_id = p.id
        LEFT JOIN ${tables.safra_propriedade} sp ON sp.propriedade_id = p.id
        WHERE ${propriedadeWhere.join(' AND ')}
      `.trim(),
      countParams: propriedadeCountParams,
    },
    atendimento: {
      entityType: 'atendimento',
      name: 'search_atendimento',
      dataQuery: `
        SELECT DISTINCT
          'atendimento' AS entityType,
          a.id AS id,
          COALESCE(p.nome, CONCAT('Atendimento ', CAST(a.id AS CHAR))) AS label,
          CONCAT('Status ', COALESCE(CAST(a.atendimento_status_id AS CHAR), '-')) AS subtitle,
          a.atendimento_status_id AS statusId,
          a.safra_id AS safraId,
          a.propriedade_id AS propriedadeId,
          COALESCE(a.data_conclusao, a.data_execucao, a.data_agendamento) AS dataReferencia
        FROM ${tables.atendimento} a
        LEFT JOIN ${tables.propriedade} p ON p.id = a.propriedade_id
        WHERE ${atendimentoWhere.join(' AND ')}
        ORDER BY COALESCE(a.data_conclusao, a.data_execucao, a.data_agendamento) DESC, a.id DESC
        LIMIT ?
      `.trim(),
      dataParams: atendimentoDataParams,
      countQuery: `
        SELECT COUNT(DISTINCT a.id) AS total
        FROM ${tables.atendimento} a
        LEFT JOIN ${tables.propriedade} p ON p.id = a.propriedade_id
        WHERE ${atendimentoWhere.join(' AND ')}
      `.trim(),
      countParams: atendimentoCountParams,
    },
    questionario: {
      entityType: 'questionario',
      name: 'search_questionario',
      dataQuery: `
        SELECT DISTINCT
          'questionario' AS entityType,
          q.id AS id,
          q.nome AS label,
          CONCAT('Protocolo ', COALESCE(CAST(q.protocolo_id AS CHAR), '-')) AS subtitle,
          NULL AS statusId,
          NULL AS safraId,
          NULL AS propriedadeId,
          NULL AS dataReferencia
        FROM ${tables.questionario} q
        INNER JOIN ${tables.protocolo} p ON p.id = q.protocolo_id
        INNER JOIN ${tables.certificadora_protocolo} cpr ON cpr.protocolo_id = p.id
        WHERE ${questionarioWhere.join(' AND ')}
        ORDER BY q.nome ASC
        LIMIT ?
      `.trim(),
      dataParams: questionarioDataParams,
      countQuery: `
        SELECT COUNT(DISTINCT q.id) AS total
        FROM ${tables.questionario} q
        INNER JOIN ${tables.protocolo} p ON p.id = q.protocolo_id
        INNER JOIN ${tables.certificadora_protocolo} cpr ON cpr.protocolo_id = p.id
        WHERE ${questionarioWhere.join(' AND ')}
      `.trim(),
      countParams: questionarioCountParams,
    },
    safra: {
      entityType: 'safra',
      name: 'search_safra',
      dataQuery: `
        SELECT DISTINCT
          'safra' AS entityType,
          s.id AS id,
          s.nome AS label,
          CONCAT(DATE_FORMAT(s.data_inicio, '%Y-%m-%d'), ' -> ', DATE_FORMAT(s.data_fim, '%Y-%m-%d')) AS subtitle,
          NULL AS statusId,
          s.id AS safraId,
          NULL AS propriedadeId,
          s.data_inicio AS dataReferencia
        FROM ${tables.safra} s
        WHERE ${safraWhere.join(' AND ')}
        ORDER BY s.data_inicio DESC, s.id DESC
        LIMIT ?
      `.trim(),
      dataParams: safraDataParams,
      countQuery: `
        SELECT COUNT(DISTINCT s.id) AS total
        FROM ${tables.safra} s
        WHERE ${safraWhere.join(' AND ')}
      `.trim(),
      countParams: safraCountParams,
    },
  }

  if (params.entityType === 'all') {
    return [
      queries.propriedade,
      queries.atendimento,
      queries.questionario,
      queries.safra,
    ]
  }

  return [queries[params.entityType]]
}

const executeSearchTool = async (
  rawParams: unknown,
  signal: AbortSignal | undefined,
): Promise<{
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}> => {
  const params = normalizeSearchParams(rawParams)
  const provenance: Array<ProvenanceEntry> = []
  const warnings: Array<string> = []

  const { resolvedTables, missingCanonicalTables } = await getResolvedTables(
    signal,
    provenance,
  )

  if (missingCanonicalTables.length > 0) {
    warnings.push(
      `Some canonical tables were not found: ${missingCanonicalTables.join(', ')}.`,
    )
  }

  if (params.usuarioId) {
    const includesQuestionarioSearch =
      params.entityType === 'all' || params.entityType === 'questionario'

    if (includesQuestionarioSearch) {
      warnings.push(
        'usuarioId permission filter is not fully applied to questionario listing in this tool.',
      )
    }
  }

  const queries = buildSearchQueries(params, resolvedTables)
  const allItems: Array<SearchItem> = []
  const totalsByEntityType: Record<
    Exclude<AgrotraceEntityType, 'all'>,
    number
  > = {
    propriedade: 0,
    atendimento: 0,
    questionario: 0,
    safra: 0,
  }

  for (const queryPlan of queries) {
    const dataResult = await callMysqlTool(
      'mysql_run_select_query',
      {
        query: queryPlan.dataQuery,
        params: queryPlan.dataParams,
      },
      signal,
      provenance,
      'search agrotrace entities',
      `${queryPlan.name}_data`,
    )

    allItems.push(...parseSearchItems(resultToRows(dataResult), params.query))

    const countResult = await callMysqlTool(
      'mysql_run_select_query',
      {
        query: queryPlan.countQuery,
        params: queryPlan.countParams,
      },
      signal,
      provenance,
      'count agrotrace entities for pagination awareness',
      `${queryPlan.name}_count`,
    )

    const countRow = resultToFirstRow(countResult)
    totalsByEntityType[queryPlan.entityType] += toNumber(countRow.total) ?? 0
  }

  const totalAvailable = Object.values(totalsByEntityType).reduce(
    (total, value) => total + value,
    0,
  )

  const dedupedItemsMap = new Map<string, SearchItem>()
  for (const item of allItems) {
    const dedupeKey = `${item.entityType}:${item.id}`
    const previousItem = dedupedItemsMap.get(dedupeKey)
    if (!previousItem || item.matchScore > previousItem.matchScore) {
      dedupedItemsMap.set(dedupeKey, item)
    }
  }

  const sortedItems = Array.from(dedupedItemsMap.values())
    .sort((first, second) => {
      if (second.matchScore !== first.matchScore) {
        return second.matchScore - first.matchScore
      }

      const firstDate = first.dataReferencia || ''
      const secondDate = second.dataReferencia || ''
      if (firstDate !== secondDate) {
        return secondDate.localeCompare(firstDate)
      }

      return first.label.localeCompare(second.label)
    })
    .slice(0, params.limit)

  const shouldIncludePreview = !isBroadSearchQuery(params.query)
  const previewLines = shouldIncludePreview
    ? sortedItems.slice(0, 12).map((item) => {
        const subtitle = item.subtitle ? ` | ${item.subtitle}` : ''
        return `- [${item.entityType}] #${item.id} ${item.label}${subtitle}`
      })
    : []

  const isTruncated = totalAvailable > sortedItems.length
  const queryLabel = isBroadSearchQuery(params.query) ? '*' : params.query

  const summaryText =
    sortedItems.length === 0
      ? `No entities matched "${queryLabel}" for certificadoraId=${params.certificadoraId}.`
      : [
          `Found ${totalAvailable} entity results for "${queryLabel}" (certificadoraId=${params.certificadoraId}).`,
          isTruncated
            ? `Showing ${sortedItems.length} items due to limit=${params.limit}.`
            : `Showing all ${sortedItems.length} available items.`,
          !shouldIncludePreview
            ? 'Use agrotrace_get_*_context tool if you need detailed rows.'
            : '',
          '',
          ...previewLines,
        ].join('\n')

  return buildToolResult(summaryText, {
    tool: 'agrotrace_search_entities',
    data: {
      items: sortedItems,
    },
    meta: {
      query: queryLabel,
      entityType: params.entityType,
      certificadoraId: params.certificadoraId,
      usuarioId: params.usuarioId,
      safraId: params.safraId,
      limit: params.limit,
      resultCount: sortedItems.length,
      totalAvailable,
      totalsByEntityType,
      truncated: isTruncated,
    },
    warnings,
    provenance,
  })
}

const executeAtendimentoContextTool = async (
  rawParams: unknown,
  signal: AbortSignal | undefined,
): Promise<{
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}> => {
  const params = normalizeAtendimentoContextParams(rawParams)
  const provenance: Array<ProvenanceEntry> = []
  const warnings: Array<string> = []

  const { resolvedTables, missingCanonicalTables } = await getResolvedTables(
    signal,
    provenance,
  )

  if (missingCanonicalTables.length > 0) {
    warnings.push(
      `Some canonical tables were not found: ${missingCanonicalTables.join(', ')}.`,
    )
  }

  const whereClauses = ['a.certificadora_id = ?']
  const whereParams: Array<unknown> = [params.certificadoraId]

  if (params.atendimentoId) {
    whereClauses.push('a.id = ?')
    whereParams.push(params.atendimentoId)
  }

  if (params.propriedadeId) {
    whereClauses.push('a.propriedade_id = ?')
    whereParams.push(params.propriedadeId)
  }

  if (params.safraId) {
    whereClauses.push('a.safra_id = ?')
    whereParams.push(params.safraId)
  }

  if (params.statusId) {
    whereClauses.push('a.atendimento_status_id = ?')
    whereParams.push(params.statusId)
  }

  if (params.usuarioId) {
    whereClauses.push(
      'FIND_IN_SET(a.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))',
    )
    whereParams.push(params.certificadoraId, params.usuarioId)
  }

  const contextQuery = `
    SELECT
      a.id AS id,
      a.atendimento_status_id AS statusId,
      a.atendimento_tipo_id AS tipoId,
      a.safra_id AS safraId,
      a.propriedade_id AS propriedadeId,
      a.tecnico_id AS tecnicoId,
      a.produtor_id AS produtorId,
      a.data_agendamento AS dataAgendamento,
      a.data_execucao AS dataExecucao,
      a.data_conclusao AS dataConclusao,
      a.observacoes AS observacoes,
      p.nome AS propriedadeNome,
      TRIM(CONCAT(COALESCE(prod.nome, ''), ' ', COALESCE(prod.sobrenome, ''))) AS produtorNome,
      COALESCE(a.data_conclusao, a.data_execucao, a.data_agendamento) AS dataReferencia
    FROM ${resolvedTables.atendimento} a
    LEFT JOIN ${resolvedTables.propriedade} p ON p.id = a.propriedade_id
    LEFT JOIN ${resolvedTables.pessoa} prod ON prod.id = a.produtor_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY COALESCE(a.data_conclusao, a.data_execucao, a.data_agendamento) DESC, a.id DESC
    LIMIT ?
  `.trim()

  const contextResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: contextQuery,
      params: [...whereParams, params.limit],
    },
    signal,
    provenance,
    'fetch atendimento operational context',
    'atendimento_context',
  )

  const atendimentoRows = resultToRows(contextResult)
  const atendimentoIds = Array.from(
    new Set(
      atendimentoRows
        .map((row) => toNumber(row.id))
        .filter((id): id is number => id !== undefined),
    ),
  )

  const respostaStatsByAtendimentoId = new Map<
    number,
    { totalRespostas: number; pendenciasIa: number }
  >()

  if (params.includeResponseStats && atendimentoIds.length > 0) {
    const inClause = atendimentoIds.map(() => '?').join(', ')

    const respostaStatsQuery = `
      SELECT
        qr.atendimento_id AS atendimentoId,
        COUNT(*) AS totalRespostas,
        SUM(CASE WHEN qr.situacao_ia = 0 THEN 1 ELSE 0 END) AS pendenciasIa
      FROM ${resolvedTables.que_resposta} qr
      WHERE qr.atendimento_id IN (${inClause})
      GROUP BY qr.atendimento_id
    `.trim()

    const respostaStatsResult = await callMysqlTool(
      'mysql_run_select_query',
      {
        query: respostaStatsQuery,
        params: atendimentoIds,
      },
      signal,
      provenance,
      'fetch atendimento response totals',
      'atendimento_response_stats',
    )

    for (const row of resultToRows(respostaStatsResult)) {
      const atendimentoId = toNumber(row.atendimentoId)
      if (!atendimentoId) continue

      respostaStatsByAtendimentoId.set(atendimentoId, {
        totalRespostas: toNumber(row.totalRespostas) ?? 0,
        pendenciasIa: toNumber(row.pendenciasIa) ?? 0,
      })
    }
  }

  const atendimentos = atendimentoRows
    .map((row) => {
      const atendimentoId = toNumber(row.id)
      if (!atendimentoId) return undefined

      const responseStats = respostaStatsByAtendimentoId.get(atendimentoId)

      return {
        id: atendimentoId,
        statusId: toNumber(row.statusId),
        tipoId: toNumber(row.tipoId),
        safraId: toNumber(row.safraId),
        propriedadeId: toNumber(row.propriedadeId),
        tecnicoId: toNumber(row.tecnicoId),
        produtorId: toNumber(row.produtorId),
        propriedadeNome: toOptionalString(row.propriedadeNome),
        produtorNome: toOptionalString(row.produtorNome),
        dataAgendamento: toOptionalString(row.dataAgendamento),
        dataExecucao: toOptionalString(row.dataExecucao),
        dataConclusao: toOptionalString(row.dataConclusao),
        observacoes: toOptionalString(row.observacoes),
        dataReferencia: toOptionalString(row.dataReferencia),
        totalRespostas: responseStats?.totalRespostas,
        pendenciasIa: responseStats?.pendenciasIa,
      }
    })
    .filter(
      (atendimento): atendimento is NonNullable<typeof atendimento> =>
        atendimento !== undefined,
    )

  const totalRespostas = atendimentos.reduce(
    (total, atendimento) => total + (atendimento.totalRespostas ?? 0),
    0,
  )
  const totalPendenciasIa = atendimentos.reduce(
    (total, atendimento) => total + (atendimento.pendenciasIa ?? 0),
    0,
  )

  const previewLines = atendimentos.slice(0, 12).map((atendimento) => {
    const propriedade =
      atendimento.propriedadeNome ||
      `Propriedade #${atendimento.propriedadeId ?? '-'}`
    return `- #${atendimento.id} | ${propriedade} | status=${atendimento.statusId ?? '-'} | safra=${atendimento.safraId ?? '-'} | respostas=${atendimento.totalRespostas ?? 0}`
  })

  const summaryText =
    atendimentos.length === 0
      ? `No atendimentos found for certificadoraId=${params.certificadoraId} with current filters.`
      : [
          `Atendimento context for certificadoraId=${params.certificadoraId}: ${atendimentos.length} records.`,
          '',
          ...previewLines,
        ].join('\n')

  return buildToolResult(summaryText, {
    tool: 'agrotrace_get_atendimento_context',
    data: {
      atendimentos,
      totals: {
        atendimentos: atendimentos.length,
        respostas: totalRespostas,
        pendenciasIa: totalPendenciasIa,
      },
    },
    meta: {
      certificadoraId: params.certificadoraId,
      atendimentoId: params.atendimentoId,
      propriedadeId: params.propriedadeId,
      safraId: params.safraId,
      statusId: params.statusId,
      usuarioId: params.usuarioId,
      includeResponseStats: params.includeResponseStats,
      limit: params.limit,
    },
    warnings,
    provenance,
  })
}

const executePropriedadeContextTool = async (
  rawParams: unknown,
  signal: AbortSignal | undefined,
): Promise<{
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}> => {
  const params = normalizePropriedadeContextParams(rawParams)
  const provenance: Array<ProvenanceEntry> = []
  const warnings: Array<string> = []

  const { resolvedTables, missingCanonicalTables } = await getResolvedTables(
    signal,
    provenance,
  )

  if (missingCanonicalTables.length > 0) {
    warnings.push(
      `Some canonical tables were not found: ${missingCanonicalTables.join(', ')}.`,
    )
  }

  const whereClauses = ['cp.certificadora_id = ?']
  const whereParams: Array<unknown> = [params.certificadoraId]

  if (params.propriedadeId) {
    whereClauses.push('cp.propriedade_id = ?')
    whereParams.push(params.propriedadeId)
  }

  if (params.safraId) {
    whereClauses.push('sp.safra_id = ?')
    whereParams.push(params.safraId)
  }

  if (params.usuarioId) {
    whereClauses.push(
      'FIND_IN_SET(cp.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))',
    )
    whereParams.push(params.certificadoraId, params.usuarioId)
  }

  const contextQuery = `
    SELECT DISTINCT
      p.id AS id,
      p.nome AS nome,
      p.produtor_id AS produtorId,
      p.area_total AS areaTotal,
      p.area_produtiva AS areaProdutiva,
      p.quantidade_funcionarios AS quantidadeFuncionarios,
      p.data_saida AS dataSaida,
      p.desativado_em AS desativadoEm,
      TRIM(CONCAT(COALESCE(prod.nome, ''), ' ', COALESCE(prod.sobrenome, ''))) AS produtorNome
    FROM ${resolvedTables.propriedade} p
    INNER JOIN ${resolvedTables.certificadora_propriedade} cp ON cp.propriedade_id = p.id
    LEFT JOIN ${resolvedTables.safra_propriedade} sp ON sp.propriedade_id = p.id
    LEFT JOIN ${resolvedTables.pessoa} prod ON prod.id = p.produtor_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY p.nome ASC
    LIMIT ?
  `.trim()

  const contextResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: contextQuery,
      params: [...whereParams, params.limit],
    },
    signal,
    provenance,
    'fetch propriedade operational context',
    'propriedade_context',
  )

  const propriedadeRows = resultToRows(contextResult)
  const propriedadeIds = Array.from(
    new Set(
      propriedadeRows
        .map((row) => toNumber(row.id))
        .filter((id): id is number => id !== undefined),
    ),
  )

  const atendimentoStatsByPropriedadeId = new Map<
    number,
    {
      totalAtendimentos: number
      atendimentosConcluidos: number
      atendimentosEmAberto: number
      safrasComAtendimento: number
    }
  >()

  const respostaStatsByPropriedadeId = new Map<
    number,
    { totalRespostas: number; pendenciasIa: number }
  >()

  const safrasByPropriedadeId = new Map<
    number,
    Array<{
      safraId: number
      safraNome?: string
      safraInicio?: string
      safraFim?: string
    }>
  >()

  if (params.includeAtendimentoStats && propriedadeIds.length > 0) {
    const inClause = toInClause(propriedadeIds)

    const atendimentoWhereClauses = [
      'a.certificadora_id = ?',
      `a.propriedade_id IN (${inClause})`,
    ]
    const atendimentoWhereParams: Array<unknown> = [
      params.certificadoraId,
      ...propriedadeIds,
    ]

    if (params.safraId) {
      atendimentoWhereClauses.push('a.safra_id = ?')
      atendimentoWhereParams.push(params.safraId)
    }

    if (params.usuarioId) {
      atendimentoWhereClauses.push(
        'FIND_IN_SET(a.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))',
      )
      atendimentoWhereParams.push(params.certificadoraId, params.usuarioId)
    }

    const atendimentoStatsQuery = `
      SELECT
        a.propriedade_id AS propriedadeId,
        COUNT(*) AS totalAtendimentos,
        SUM(CASE WHEN a.data_conclusao IS NOT NULL THEN 1 ELSE 0 END) AS atendimentosConcluidos,
        SUM(CASE WHEN a.data_conclusao IS NULL AND a.data_agendamento IS NOT NULL THEN 1 ELSE 0 END) AS atendimentosEmAberto,
        COUNT(DISTINCT a.safra_id) AS safrasComAtendimento
      FROM ${resolvedTables.atendimento} a
      WHERE ${atendimentoWhereClauses.join(' AND ')}
      GROUP BY a.propriedade_id
    `.trim()

    const atendimentoStatsResult = await callMysqlTool(
      'mysql_run_select_query',
      {
        query: atendimentoStatsQuery,
        params: atendimentoWhereParams,
      },
      signal,
      provenance,
      'aggregate atendimento stats by propriedade',
      'propriedade_atendimento_stats',
    )

    for (const row of resultToRows(atendimentoStatsResult)) {
      const propriedadeId = toNumber(row.propriedadeId)
      if (!propriedadeId) continue

      atendimentoStatsByPropriedadeId.set(propriedadeId, {
        totalAtendimentos: toNumber(row.totalAtendimentos) ?? 0,
        atendimentosConcluidos: toNumber(row.atendimentosConcluidos) ?? 0,
        atendimentosEmAberto: toNumber(row.atendimentosEmAberto) ?? 0,
        safrasComAtendimento: toNumber(row.safrasComAtendimento) ?? 0,
      })
    }

    const respostaStatsQuery = `
      SELECT
        a.propriedade_id AS propriedadeId,
        COUNT(qr.id) AS totalRespostas,
        SUM(CASE WHEN qr.situacao_ia = 0 THEN 1 ELSE 0 END) AS pendenciasIa
      FROM ${resolvedTables.atendimento} a
      LEFT JOIN ${resolvedTables.que_resposta} qr ON qr.atendimento_id = a.id
      WHERE ${atendimentoWhereClauses.join(' AND ')}
      GROUP BY a.propriedade_id
    `.trim()

    const respostaStatsResult = await callMysqlTool(
      'mysql_run_select_query',
      {
        query: respostaStatsQuery,
        params: atendimentoWhereParams,
      },
      signal,
      provenance,
      'aggregate resposta stats by propriedade',
      'propriedade_resposta_stats',
    )

    for (const row of resultToRows(respostaStatsResult)) {
      const propriedadeId = toNumber(row.propriedadeId)
      if (!propriedadeId) continue

      respostaStatsByPropriedadeId.set(propriedadeId, {
        totalRespostas: toNumber(row.totalRespostas) ?? 0,
        pendenciasIa: toNumber(row.pendenciasIa) ?? 0,
      })
    }
  }

  if (propriedadeIds.length > 0) {
    const inClause = toInClause(propriedadeIds)
    const safraWhereClauses = [
      `sp.propriedade_id IN (${inClause})`,
      's.certificadora_id = ?',
    ]
    const safraWhereParams: Array<unknown> = [
      ...propriedadeIds,
      params.certificadoraId,
    ]

    if (params.safraId) {
      safraWhereClauses.push('s.id = ?')
      safraWhereParams.push(params.safraId)
    }

    const safrasQuery = `
      SELECT
        sp.propriedade_id AS propriedadeId,
        s.id AS safraId,
        s.nome AS safraNome,
        s.data_inicio AS safraInicio,
        s.data_fim AS safraFim
      FROM ${resolvedTables.safra_propriedade} sp
      INNER JOIN ${resolvedTables.safra} s ON s.id = sp.safra_id
      WHERE ${safraWhereClauses.join(' AND ')}
      ORDER BY s.data_inicio DESC, s.id DESC
    `.trim()

    const safrasResult = await callMysqlTool(
      'mysql_run_select_query',
      {
        query: safrasQuery,
        params: safraWhereParams,
      },
      signal,
      provenance,
      'fetch safra list per propriedade',
      'propriedade_safras',
    )

    for (const row of resultToRows(safrasResult)) {
      const propriedadeId = toNumber(row.propriedadeId)
      const safraId = toNumber(row.safraId)
      if (!propriedadeId || !safraId) continue

      const safraList = safrasByPropriedadeId.get(propriedadeId) ?? []
      if (safraList.length >= 5) continue

      safraList.push({
        safraId,
        safraNome: toOptionalString(row.safraNome),
        safraInicio: toOptionalString(row.safraInicio),
        safraFim: toOptionalString(row.safraFim),
      })
      safrasByPropriedadeId.set(propriedadeId, safraList)
    }
  }

  const propriedades = propriedadeRows
    .map((row) => {
      const propriedadeId = toNumber(row.id)
      if (!propriedadeId) return undefined

      const atendimentoStats =
        atendimentoStatsByPropriedadeId.get(propriedadeId)
      const respostaStats = respostaStatsByPropriedadeId.get(propriedadeId)

      return {
        id: propriedadeId,
        nome: toOptionalString(row.nome) ?? `Propriedade ${propriedadeId}`,
        produtorId: toNumber(row.produtorId),
        produtorNome: toOptionalString(row.produtorNome),
        areaTotal: toNumber(row.areaTotal),
        areaProdutiva: toNumber(row.areaProdutiva),
        quantidadeFuncionarios: toNumber(row.quantidadeFuncionarios),
        dataSaida: toOptionalString(row.dataSaida),
        desativadoEm: toOptionalString(row.desativadoEm),
        totalAtendimentos: atendimentoStats?.totalAtendimentos,
        atendimentosConcluidos: atendimentoStats?.atendimentosConcluidos,
        atendimentosEmAberto: atendimentoStats?.atendimentosEmAberto,
        safrasComAtendimento: atendimentoStats?.safrasComAtendimento,
        totalRespostas: respostaStats?.totalRespostas,
        pendenciasIa: respostaStats?.pendenciasIa,
        safras: safrasByPropriedadeId.get(propriedadeId) ?? [],
      }
    })
    .filter(
      (propriedade): propriedade is NonNullable<typeof propriedade> =>
        propriedade !== undefined,
    )

  const totals = {
    propriedades: propriedades.length,
    atendimentos: propriedades.reduce(
      (total, propriedade) => total + (propriedade.totalAtendimentos ?? 0),
      0,
    ),
    respostas: propriedades.reduce(
      (total, propriedade) => total + (propriedade.totalRespostas ?? 0),
      0,
    ),
  }

  const previewLines = propriedades.slice(0, 12).map((propriedade) => {
    return `- #${propriedade.id} | ${propriedade.nome} | produtor=${propriedade.produtorNome ?? propriedade.produtorId ?? '-'} | atendimentos=${propriedade.totalAtendimentos ?? 0} | respostas=${propriedade.totalRespostas ?? 0}`
  })

  const summaryText =
    propriedades.length === 0
      ? `No propriedades found for certificadoraId=${params.certificadoraId} with current filters.`
      : [
          `Propriedade context for certificadoraId=${params.certificadoraId}: ${propriedades.length} records.`,
          '',
          ...previewLines,
        ].join('\n')

  return buildToolResult(summaryText, {
    tool: 'agrotrace_get_propriedade_context',
    data: {
      propriedades,
      totals,
    },
    meta: {
      certificadoraId: params.certificadoraId,
      propriedadeId: params.propriedadeId,
      safraId: params.safraId,
      usuarioId: params.usuarioId,
      includeAtendimentoStats: params.includeAtendimentoStats,
      limit: params.limit,
    },
    warnings,
    provenance,
  })
}

const executeQuestionarioContextTool = async (
  rawParams: unknown,
  signal: AbortSignal | undefined,
): Promise<{
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}> => {
  const params = normalizeQuestionarioContextParams(rawParams)
  const provenance: Array<ProvenanceEntry> = []
  const warnings: Array<string> = []

  const { resolvedTables, missingCanonicalTables } = await getResolvedTables(
    signal,
    provenance,
  )

  if (missingCanonicalTables.length > 0) {
    warnings.push(
      `Some canonical tables were not found: ${missingCanonicalTables.join(', ')}.`,
    )
  }

  const whereClauses = ['cpr.certificadora_id = ?']
  const whereParams: Array<unknown> = [params.certificadoraId]

  if (params.questionarioId) {
    whereClauses.push('q.id = ?')
    whereParams.push(params.questionarioId)
  }

  if (params.protocoloId) {
    whereClauses.push('q.protocolo_id = ?')
    whereParams.push(params.protocoloId)
  }

  const contextQuery = `
    SELECT
      q.id AS id,
      q.nome AS nome,
      q.protocolo_id AS protocoloId,
      p.nome AS protocoloNome,
      COUNT(DISTINCT qt.id) AS totalTemas,
      COUNT(DISTINCT qs.id) AS totalSubtemas,
      COUNT(DISTINCT qp.id) AS totalPerguntas
    FROM ${resolvedTables.questionario} q
    INNER JOIN ${resolvedTables.protocolo} p ON p.id = q.protocolo_id
    INNER JOIN ${resolvedTables.certificadora_protocolo} cpr ON cpr.protocolo_id = p.id
    LEFT JOIN ${resolvedTables.que_tema} qt ON qt.questionario_id = q.id AND qt.desativado_em IS NULL
    LEFT JOIN ${resolvedTables.que_subtema} qs ON qs.que_tema_id = qt.id AND qs.desativado_em IS NULL
    LEFT JOIN ${resolvedTables.que_pergunta} qp ON qp.que_subtema_id = qs.id AND qp.desativado_em IS NULL
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY q.id, q.nome, q.protocolo_id, p.nome
    ORDER BY q.nome ASC
    LIMIT ?
  `.trim()

  const contextResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: contextQuery,
      params: [...whereParams, params.limit],
    },
    signal,
    provenance,
    'fetch questionario structural context',
    'questionario_context',
  )

  const questionarioRows = resultToRows(contextResult)
  const questionarioIds = Array.from(
    new Set(
      questionarioRows
        .map((row) => toNumber(row.id))
        .filter((id): id is number => id !== undefined),
    ),
  )

  const responseStatsByQuestionarioId = new Map<
    number,
    {
      totalRespostas: number
      atendimentosComResposta: number
      pendenciasIa: number
    }
  >()

  if (params.includeResponseStats && questionarioIds.length > 0) {
    const inClause = toInClause(questionarioIds)
    const statsWhereClauses = [
      'cpr.certificadora_id = ?',
      'a.certificadora_id = ?',
      `q.id IN (${inClause})`,
    ]
    const statsWhereParams: Array<unknown> = [
      params.certificadoraId,
      params.certificadoraId,
      ...questionarioIds,
    ]

    if (params.safraId) {
      statsWhereClauses.push('a.safra_id = ?')
      statsWhereParams.push(params.safraId)
    }

    if (params.usuarioId) {
      statsWhereClauses.push(
        'FIND_IN_SET(a.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))',
      )
      statsWhereParams.push(params.certificadoraId, params.usuarioId)
    }

    const responseStatsQuery = `
      SELECT
        q.id AS questionarioId,
        COUNT(qr.id) AS totalRespostas,
        COUNT(DISTINCT qr.atendimento_id) AS atendimentosComResposta,
        SUM(CASE WHEN qr.situacao_ia = 0 THEN 1 ELSE 0 END) AS pendenciasIa
      FROM ${resolvedTables.que_resposta} qr
      INNER JOIN ${resolvedTables.atendimento} a ON a.id = qr.atendimento_id
      INNER JOIN ${resolvedTables.que_pergunta} qp ON qp.id = qr.que_pergunta_id
      INNER JOIN ${resolvedTables.que_subtema} qs ON qs.id = qp.que_subtema_id
      INNER JOIN ${resolvedTables.que_tema} qt ON qt.id = qs.que_tema_id
      INNER JOIN ${resolvedTables.questionario} q ON q.id = qt.questionario_id
      INNER JOIN ${resolvedTables.protocolo} p ON p.id = q.protocolo_id
      INNER JOIN ${resolvedTables.certificadora_protocolo} cpr ON cpr.protocolo_id = p.id
      WHERE ${statsWhereClauses.join(' AND ')}
      GROUP BY q.id
    `.trim()

    const responseStatsResult = await callMysqlTool(
      'mysql_run_select_query',
      {
        query: responseStatsQuery,
        params: statsWhereParams,
      },
      signal,
      provenance,
      'aggregate response stats by questionario',
      'questionario_response_stats',
    )

    for (const row of resultToRows(responseStatsResult)) {
      const questionarioId = toNumber(row.questionarioId)
      if (!questionarioId) continue

      responseStatsByQuestionarioId.set(questionarioId, {
        totalRespostas: toNumber(row.totalRespostas) ?? 0,
        atendimentosComResposta: toNumber(row.atendimentosComResposta) ?? 0,
        pendenciasIa: toNumber(row.pendenciasIa) ?? 0,
      })
    }
  }

  const questionarios = questionarioRows
    .map((row) => {
      const questionarioId = toNumber(row.id)
      if (!questionarioId) return undefined

      const responseStats = responseStatsByQuestionarioId.get(questionarioId)

      return {
        id: questionarioId,
        nome: toOptionalString(row.nome) ?? `Questionario ${questionarioId}`,
        protocoloId: toNumber(row.protocoloId),
        protocoloNome: toOptionalString(row.protocoloNome),
        totalTemas: toNumber(row.totalTemas) ?? 0,
        totalSubtemas: toNumber(row.totalSubtemas) ?? 0,
        totalPerguntas: toNumber(row.totalPerguntas) ?? 0,
        totalRespostas: responseStats?.totalRespostas,
        atendimentosComResposta: responseStats?.atendimentosComResposta,
        pendenciasIa: responseStats?.pendenciasIa,
      }
    })
    .filter(
      (questionario): questionario is NonNullable<typeof questionario> =>
        questionario !== undefined,
    )

  const totals = {
    questionarios: questionarios.length,
    temas: questionarios.reduce(
      (total, questionario) => total + questionario.totalTemas,
      0,
    ),
    subtemas: questionarios.reduce(
      (total, questionario) => total + questionario.totalSubtemas,
      0,
    ),
    perguntas: questionarios.reduce(
      (total, questionario) => total + questionario.totalPerguntas,
      0,
    ),
    respostas: questionarios.reduce(
      (total, questionario) => total + (questionario.totalRespostas ?? 0),
      0,
    ),
  }

  const previewLines = questionarios.slice(0, 12).map((questionario) => {
    return `- #${questionario.id} | ${questionario.nome} | protocolo=${questionario.protocoloNome ?? questionario.protocoloId ?? '-'} | perguntas=${questionario.totalPerguntas} | respostas=${questionario.totalRespostas ?? 0}`
  })

  const summaryText =
    questionarios.length === 0
      ? `No questionarios found for certificadoraId=${params.certificadoraId} with current filters.`
      : [
          `Questionario context for certificadoraId=${params.certificadoraId}: ${questionarios.length} records.`,
          '',
          ...previewLines,
        ].join('\n')

  return buildToolResult(summaryText, {
    tool: 'agrotrace_get_questionario_context',
    data: {
      questionarios,
      totals,
    },
    meta: {
      certificadoraId: params.certificadoraId,
      questionarioId: params.questionarioId,
      protocoloId: params.protocoloId,
      safraId: params.safraId,
      usuarioId: params.usuarioId,
      includeResponseStats: params.includeResponseStats,
      limit: params.limit,
    },
    warnings,
    provenance,
  })
}

const buildAtendimentoScope = (
  alias: string,
  params: KpiSnapshotParams,
): { whereSql: string; whereParams: Array<unknown> } => {
  const whereClauses = [`${alias}.certificadora_id = ?`]
  const whereParams: Array<unknown> = [params.certificadoraId]

  if (params.safraId) {
    whereClauses.push(`${alias}.safra_id = ?`)
    whereParams.push(params.safraId)
  }

  if (params.propriedadeId) {
    whereClauses.push(`${alias}.propriedade_id = ?`)
    whereParams.push(params.propriedadeId)
  }

  if (params.fromDate) {
    whereClauses.push(
      `DATE(COALESCE(${alias}.data_conclusao, ${alias}.data_execucao, ${alias}.data_agendamento)) >= ?`,
    )
    whereParams.push(params.fromDate)
  }

  if (params.toDate) {
    whereClauses.push(
      `DATE(COALESCE(${alias}.data_conclusao, ${alias}.data_execucao, ${alias}.data_agendamento)) <= ?`,
    )
    whereParams.push(params.toDate)
  }

  if (params.usuarioId) {
    whereClauses.push(
      `FIND_IN_SET(${alias}.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))`,
    )
    whereParams.push(params.certificadoraId, params.usuarioId)
  }

  return {
    whereSql: whereClauses.join(' AND '),
    whereParams,
  }
}

const executeKpiSnapshotTool = async (
  rawParams: unknown,
  signal: AbortSignal | undefined,
): Promise<{
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}> => {
  const params = normalizeKpiSnapshotParams(rawParams)
  const provenance: Array<ProvenanceEntry> = []
  const warnings: Array<string> = []

  const { resolvedTables, missingCanonicalTables } = await getResolvedTables(
    signal,
    provenance,
  )

  if (missingCanonicalTables.length > 0) {
    warnings.push(
      `Some canonical tables were not found: ${missingCanonicalTables.join(', ')}.`,
    )
  }

  const atendimentoScope = buildAtendimentoScope('a', params)

  const atendimentoTotalsQuery = `
    SELECT
      COUNT(*) AS totalAtendimentos,
      SUM(CASE WHEN a.data_conclusao IS NOT NULL THEN 1 ELSE 0 END) AS atendimentosConcluidos,
      SUM(CASE WHEN a.data_conclusao IS NULL AND a.data_agendamento IS NOT NULL THEN 1 ELSE 0 END) AS atendimentosEmAberto,
      COUNT(DISTINCT a.propriedade_id) AS propriedadesComAtendimento
    FROM ${resolvedTables.atendimento} a
    WHERE ${atendimentoScope.whereSql}
  `.trim()

  const atendimentoTotalsResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: atendimentoTotalsQuery,
      params: atendimentoScope.whereParams,
    },
    signal,
    provenance,
    'aggregate atendimento KPIs',
    'kpi_atendimento_totals',
  )

  const statusBreakdownQuery = `
    SELECT
      a.atendimento_status_id AS statusId,
      COUNT(*) AS total
    FROM ${resolvedTables.atendimento} a
    WHERE ${atendimentoScope.whereSql}
    GROUP BY a.atendimento_status_id
    ORDER BY total DESC
    LIMIT 20
  `.trim()

  const statusBreakdownResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: statusBreakdownQuery,
      params: atendimentoScope.whereParams,
    },
    signal,
    provenance,
    'aggregate atendimento status breakdown',
    'kpi_status_breakdown',
  )

  const propriedadeWhereClauses = ['cp.certificadora_id = ?']
  const propriedadeWhereParams: Array<unknown> = [params.certificadoraId]

  if (params.safraId) {
    propriedadeWhereClauses.push('sp.safra_id = ?')
    propriedadeWhereParams.push(params.safraId)
  }

  if (params.propriedadeId) {
    propriedadeWhereClauses.push('cp.propriedade_id = ?')
    propriedadeWhereParams.push(params.propriedadeId)
  }

  if (params.usuarioId) {
    propriedadeWhereClauses.push(
      'FIND_IN_SET(cp.propriedade_id, getPropriedadeFilialUsuario(?, ?, 0))',
    )
    propriedadeWhereParams.push(params.certificadoraId, params.usuarioId)
  }

  const propriedadeTotalsQuery = `
    SELECT COUNT(DISTINCT cp.propriedade_id) AS totalPropriedades
    FROM ${resolvedTables.certificadora_propriedade} cp
    LEFT JOIN ${resolvedTables.safra_propriedade} sp ON sp.propriedade_id = cp.propriedade_id
    WHERE ${propriedadeWhereClauses.join(' AND ')}
  `.trim()

  const propriedadeTotalsResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: propriedadeTotalsQuery,
      params: propriedadeWhereParams,
    },
    signal,
    provenance,
    'aggregate propriedade KPI',
    'kpi_propriedade_totals',
  )

  const safraWhereClauses = ['s.certificadora_id = ?']
  const safraWhereParams: Array<unknown> = [params.certificadoraId]

  if (params.safraId) {
    safraWhereClauses.push('s.id = ?')
    safraWhereParams.push(params.safraId)
  }

  const safraTotalsQuery = `
    SELECT COUNT(*) AS totalSafras
    FROM ${resolvedTables.safra} s
    WHERE ${safraWhereClauses.join(' AND ')}
  `.trim()

  const safraTotalsResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: safraTotalsQuery,
      params: safraWhereParams,
    },
    signal,
    provenance,
    'aggregate safra KPI',
    'kpi_safra_totals',
  )

  const questionarioTotalsQuery = `
    SELECT COUNT(DISTINCT q.id) AS totalQuestionarios
    FROM ${resolvedTables.questionario} q
    INNER JOIN ${resolvedTables.protocolo} p ON p.id = q.protocolo_id
    INNER JOIN ${resolvedTables.certificadora_protocolo} cpr ON cpr.protocolo_id = p.id
    WHERE cpr.certificadora_id = ?
  `.trim()

  const questionarioTotalsResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: questionarioTotalsQuery,
      params: [params.certificadoraId],
    },
    signal,
    provenance,
    'aggregate questionario KPI',
    'kpi_questionario_totals',
  )

  const respostaTotalsQuery = `
    SELECT
      COUNT(*) AS totalRespostas,
      SUM(CASE WHEN qr.situacao_ia = 0 THEN 1 ELSE 0 END) AS pendenciasIa
    FROM ${resolvedTables.que_resposta} qr
    INNER JOIN ${resolvedTables.atendimento} a ON a.id = qr.atendimento_id
    WHERE ${atendimentoScope.whereSql}
  `.trim()

  const respostaTotalsResult = await callMysqlTool(
    'mysql_run_select_query',
    {
      query: respostaTotalsQuery,
      params: atendimentoScope.whereParams,
    },
    signal,
    provenance,
    'aggregate resposta KPI',
    'kpi_resposta_totals',
  )

  const atendimentoTotals = resultToFirstRow(atendimentoTotalsResult)
  const propriedadeTotals = resultToFirstRow(propriedadeTotalsResult)
  const safraTotals = resultToFirstRow(safraTotalsResult)
  const questionarioTotals = resultToFirstRow(questionarioTotalsResult)
  const respostaTotals = resultToFirstRow(respostaTotalsResult)

  const statusBreakdown = resultToRows(statusBreakdownResult).map((row) => ({
    statusId: toNumber(row.statusId),
    total: toNumber(row.total) ?? 0,
  }))

  const snapshot = {
    totalAtendimentos: toNumber(atendimentoTotals.totalAtendimentos) ?? 0,
    atendimentosConcluidos:
      toNumber(atendimentoTotals.atendimentosConcluidos) ?? 0,
    atendimentosEmAberto: toNumber(atendimentoTotals.atendimentosEmAberto) ?? 0,
    propriedadesComAtendimento:
      toNumber(atendimentoTotals.propriedadesComAtendimento) ?? 0,
    totalPropriedades: toNumber(propriedadeTotals.totalPropriedades) ?? 0,
    totalSafras: toNumber(safraTotals.totalSafras) ?? 0,
    totalQuestionarios: toNumber(questionarioTotals.totalQuestionarios) ?? 0,
    totalRespostas: toNumber(respostaTotals.totalRespostas) ?? 0,
    pendenciasIa: toNumber(respostaTotals.pendenciasIa) ?? 0,
  }

  const summaryText = [
    `KPI snapshot for certificadoraId=${params.certificadoraId}.`,
    '',
    `- Atendimentos: ${snapshot.totalAtendimentos}`,
    `- Concluidos: ${snapshot.atendimentosConcluidos}`,
    `- Em aberto: ${snapshot.atendimentosEmAberto}`,
    `- Propriedades no escopo: ${snapshot.totalPropriedades}`,
    `- Safras no escopo: ${snapshot.totalSafras}`,
    `- Questionarios vinculados: ${snapshot.totalQuestionarios}`,
    `- Respostas: ${snapshot.totalRespostas}`,
    `- Pendencias IA: ${snapshot.pendenciasIa}`,
  ].join('\n')

  return buildToolResult(summaryText, {
    tool: 'agrotrace_kpi_snapshot',
    data: {
      snapshot,
      statusBreakdown,
    },
    meta: {
      certificadoraId: params.certificadoraId,
      safraId: params.safraId,
      propriedadeId: params.propriedadeId,
      usuarioId: params.usuarioId,
      fromDate: params.fromDate,
      toDate: params.toDate,
    },
    warnings,
    provenance,
  })
}

export const createAgrotraceMcpTools = (): Array<ToolDefinition> => [
  {
    name: 'agrotrace_search_entities',
    label: 'Agrotrace Entity Search',
    description:
      'Search propriedades, atendimentos, questionarios and safras with tenant-safe filters.',
    parameters: SEARCH_PARAMETERS,
    execute: async (_toolCallId, params, signal) =>
      await executeSearchTool(params, signal),
  },
  {
    name: 'agrotrace_get_propriedade_context',
    label: 'Agrotrace Propriedade Context',
    description:
      'Fetch propriedade context with optional atendimento and resposta indicators.',
    parameters: PROPRIEDADE_CONTEXT_PARAMETERS,
    execute: async (_toolCallId, params, signal) =>
      await executePropriedadeContextTool(params, signal),
  },
  {
    name: 'agrotrace_get_atendimento_context',
    label: 'Agrotrace Atendimento Context',
    description:
      'Fetch operational atendimento context by tenant and optional filters.',
    parameters: ATENDIMENTO_CONTEXT_PARAMETERS,
    execute: async (_toolCallId, params, signal) =>
      await executeAtendimentoContextTool(params, signal),
  },
  {
    name: 'agrotrace_get_questionario_context',
    label: 'Agrotrace Questionario Context',
    description:
      'Fetch questionario structure and optional response indicators in tenant scope.',
    parameters: QUESTIONARIO_CONTEXT_PARAMETERS,
    execute: async (_toolCallId, params, signal) =>
      await executeQuestionarioContextTool(params, signal),
  },
  {
    name: 'agrotrace_kpi_snapshot',
    label: 'Agrotrace KPI Snapshot',
    description:
      'Build tenant-scoped KPI snapshot for atendimentos, propriedades, safras, questionarios and respostas.',
    parameters: KPI_SNAPSHOT_PARAMETERS,
    execute: async (_toolCallId, params, signal) =>
      await executeKpiSnapshotTool(params, signal),
  },
]
