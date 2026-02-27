export type AgrotraceIntent = 'consulta' | 'comparacao' | 'explicacao' | 'acao'

export type AgrotraceDomain =
  | 'propriedades'
  | 'atendimentos'
  | 'questionarios'
  | 'safras'
  | 'geral'
  | 'multi'

type ScopedDomain = Exclude<AgrotraceDomain, 'geral' | 'multi'>

type ScopeKey = 'certificadoraId' | 'usuarioId'

type AgrotraceToolName =
  | 'agrotrace_search_entities'
  | 'agrotrace_get_propriedade_context'
  | 'agrotrace_get_atendimento_context'
  | 'agrotrace_get_questionario_context'
  | 'agrotrace_kpi_snapshot'

type AgrotraceSkillName =
  | 'pdf'
  | 'data-spreadsheet'
  | 'chart-visualization'
  | 'infographic-creator'

export type AgrotraceRoute = {
  intent: AgrotraceIntent
  domain: AgrotraceDomain
  domainScores: Record<ScopedDomain, number>
  missingScope: Array<ScopeKey>
  detectedScope: Partial<Record<ScopeKey, string>>
}

const DOMAIN_KEYWORDS: Record<ScopedDomain, Array<string>> = {
  propriedades: [
    'propriedade',
    'propriedades',
    'fazenda',
    'fazendas',
    'produtor',
    'produtores',
    'car',
    'bioma',
    'filial',
  ],
  atendimentos: [
    'atendimento',
    'atendimentos',
    'agenda',
    'agendamento',
    'execucao',
    'conclusao',
    'tecnico',
    'status',
    'plano de acao',
  ],
  questionarios: [
    'questionario',
    'questionarios',
    'tema',
    'subtema',
    'pergunta',
    'perguntas',
    'resposta',
    'respostas',
    'nao conformidade',
    'protocolo',
  ],
  safras: ['safra', 'safras', 'periodo', 'temporada', 'ciclo', 'colheita'],
}

const ACTION_KEYWORDS = [
  'criar',
  'atualizar',
  'editar',
  'apagar',
  'deletar',
  'remover',
  'inativar',
  'agendar',
  'concluir',
  'reabrir',
]

const COMPARISON_KEYWORDS = [
  'comparar',
  'comparacao',
  'comparativo',
  'versus',
  ' vs ',
  'diferenca',
  'evolucao',
  'tendencia',
]

const EXPLANATION_KEYWORDS = [
  'o que',
  'como',
  'explique',
  'explica',
  'detalhe',
  'porque',
  'por que',
]

const COUNT_KEYWORDS = [
  'quanto',
  'quantos',
  'quantas',
  'total',
  'totais',
  'quantidade',
  'numero',
  'numero de',
  'qtd',
  'cadastradas',
  'cadastrados',
]

const PDF_KEYWORDS = [
  'pdf',
  'relatorio',
  'documento',
  'imprimir',
  'exportar pdf',
]

const SPREADSHEET_KEYWORDS = ['planilha', 'excel', 'xlsx', 'csv', 'tabela']

const CHART_KEYWORDS = [
  'grafico',
  'chart',
  'visualizacao',
  'tendencia visual',
  'plot',
]

const INFOGRAPHIC_KEYWORDS = [
  'infografico',
  'infographic',
  'resumo visual',
  'storytelling visual',
]

const EXECUTIVE_VISUAL_KEYWORDS = [
  'resumo executivo visual',
  'resumo executivo',
  'sumario executivo',
  'sumario gerencial',
  'resumo gerencial',
  'visao executiva',
  'visao gerencial',
  'apresentacao executiva',
  'dashboard executivo',
  'dashboard gerencial',
  'executive summary',
  'executive dashboard',
  'one pager',
  'one-pager',
]

const DOMAIN_INSTRUCTIONS: Record<AgrotraceDomain, string> = {
  propriedades:
    'Priorize Propriedade e seus vinculos com produtor, safra, atendimentos e geolocalizacao.',
  atendimentos:
    'Priorize Atendimento com foco em status, agenda, tecnico, datas e pendencias operacionais.',
  questionarios:
    'Priorize Questionario, Tema, Subtema, Pergunta e QueResposta para explicar nao conformidades e cobertura.',
  safras:
    'Priorize Safra como eixo temporal e faca cortes comparaveis por periodo e escopo.',
  multi:
    'Trate como consulta transversal entre dominios e explicite como cada dominio contribui para a resposta.',
  geral:
    'Mantenha resposta objetiva e peca filtros minimos antes de consultas amplas.',
}

const INTENT_INSTRUCTIONS: Record<AgrotraceIntent, string> = {
  consulta:
    'Entregue um resumo operacional direto, com os itens principais primeiro e detalhes em seguida.',
  comparacao:
    'Compare com criterios iguais entre os grupos e destaque variacoes relevantes e possiveis causas.',
  explicacao:
    'Explique de forma didatica, curta e orientada a acao, sem perder a rastreabilidade dos dados.',
  acao: 'Estamos em modo read-only. Nao execute escrita. Explique passo a passo, pre-condicoes e validacoes.',
}

const normalizeText = (input: string): string =>
  input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const isCountRequest = (text: string): boolean =>
  COUNT_KEYWORDS.some((keyword) => hasKeyword(text, keyword))

const getRecommendedSkills = (text: string): Array<AgrotraceSkillName> => {
  const requestedSkills: Array<AgrotraceSkillName> = []
  const executiveVisualRequest = EXECUTIVE_VISUAL_KEYWORDS.some((keyword) =>
    hasKeyword(text, keyword),
  )

  if (executiveVisualRequest) {
    requestedSkills.push('infographic-creator')
  }

  if (PDF_KEYWORDS.some((keyword) => hasKeyword(text, keyword))) {
    requestedSkills.push('pdf')
  }

  if (SPREADSHEET_KEYWORDS.some((keyword) => hasKeyword(text, keyword))) {
    requestedSkills.push('data-spreadsheet')
  }

  if (CHART_KEYWORDS.some((keyword) => hasKeyword(text, keyword))) {
    requestedSkills.push('chart-visualization')
  }

  if (INFOGRAPHIC_KEYWORDS.some((keyword) => hasKeyword(text, keyword))) {
    requestedSkills.push('infographic-creator')
  }

  return Array.from(new Set(requestedSkills))
}

const hasKeyword = (text: string, keyword: string): boolean => {
  if (!keyword.trim()) return false
  if (keyword.includes(' ')) return text.includes(keyword)

  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const keywordRegex = new RegExp(`\\b${escapedKeyword}\\b`, 'i')
  return keywordRegex.test(text)
}

const scoreDomain = (text: string, keywords: Array<string>): number =>
  keywords.reduce(
    (total, keyword) => total + (hasKeyword(text, keyword) ? 1 : 0),
    0,
  )

const detectIntent = (text: string): AgrotraceIntent => {
  if (ACTION_KEYWORDS.some((keyword) => hasKeyword(text, keyword))) {
    return 'acao'
  }

  if (COMPARISON_KEYWORDS.some((keyword) => hasKeyword(text, keyword))) {
    return 'comparacao'
  }

  if (EXPLANATION_KEYWORDS.some((keyword) => hasKeyword(text, keyword))) {
    return 'explicacao'
  }

  return 'consulta'
}

const detectScopeValue = (
  text: string,
  aliases: Array<string>,
): string | undefined => {
  for (const alias of aliases) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(
      `${escapedAlias}(?:\\s+id|_id|id)?\\s*[:=]?\\s*(\\d+)`,
      'i',
    )

    const match = regex.exec(text)
    if (match?.[1]) return match[1]
  }

  return undefined
}

export const classifyAgrotraceRoute = (userText: string): AgrotraceRoute => {
  const normalizedText = normalizeText(userText)

  const domainScores: Record<ScopedDomain, number> = {
    propriedades: scoreDomain(normalizedText, DOMAIN_KEYWORDS.propriedades),
    atendimentos: scoreDomain(normalizedText, DOMAIN_KEYWORDS.atendimentos),
    questionarios: scoreDomain(normalizedText, DOMAIN_KEYWORDS.questionarios),
    safras: scoreDomain(normalizedText, DOMAIN_KEYWORDS.safras),
  }

  const orderedScores = (
    Object.entries(domainScores) as Array<[ScopedDomain, number]>
  ).sort((first, second) => second[1] - first[1])

  const highestScore = orderedScores[0]?.[1] ?? 0
  const topDomains = orderedScores
    .filter(([, score]) => score > 0 && score === highestScore)
    .map(([domain]) => domain)

  let domain: AgrotraceDomain = 'geral'
  if (topDomains.length === 1) {
    domain = topDomains[0]
  } else if (topDomains.length > 1) {
    domain = 'multi'
  }

  const detectedScope: AgrotraceRoute['detectedScope'] = {
    certificadoraId: detectScopeValue(normalizedText, [
      'certificadora',
      'certificadoraid',
      'tenant',
      'empresa',
    ]),
    usuarioId: detectScopeValue(normalizedText, ['usuario', 'usuarioid']),
  }

  const missingScope: Array<ScopeKey> = []
  if (!detectedScope.certificadoraId) {
    missingScope.push('certificadoraId')
  }
  if (!detectedScope.usuarioId) {
    missingScope.push('usuarioId')
  }

  return {
    intent: detectIntent(normalizedText),
    domain,
    domainScores,
    missingScope,
    detectedScope,
  }
}

const formatRouteMetadata = (route: AgrotraceRoute): string => {
  const scoreSummary = [
    `propriedades:${route.domainScores.propriedades}`,
    `atendimentos:${route.domainScores.atendimentos}`,
    `questionarios:${route.domainScores.questionarios}`,
    `safras:${route.domainScores.safras}`,
  ].join(', ')

  const missingScope =
    route.missingScope.length > 0 ? route.missingScope.join(', ') : 'none'

  return [
    `intent=${route.intent}`,
    `domain=${route.domain}`,
    `domain_scores=${scoreSummary}`,
    `missing_scope=${missingScope}`,
  ].join('\n')
}

const getRecommendedTools = (
  route: AgrotraceRoute,
): Array<AgrotraceToolName> => {
  const recommendedTools: Array<AgrotraceToolName> = [
    'agrotrace_search_entities',
  ]

  if (route.domain === 'propriedades') {
    recommendedTools.push('agrotrace_get_propriedade_context')
  }

  if (route.domain === 'atendimentos') {
    recommendedTools.push('agrotrace_get_atendimento_context')
  }

  if (route.domain === 'questionarios') {
    recommendedTools.push('agrotrace_get_questionario_context')
  }

  if (route.domain === 'safras') {
    recommendedTools.push('agrotrace_kpi_snapshot')
  }

  if (route.domain === 'multi') {
    recommendedTools.push('agrotrace_get_propriedade_context')
    recommendedTools.push('agrotrace_get_atendimento_context')
    recommendedTools.push('agrotrace_get_questionario_context')
    recommendedTools.push('agrotrace_kpi_snapshot')
  }

  if (route.intent === 'comparacao') {
    recommendedTools.push('agrotrace_kpi_snapshot')
  }

  const deduplicatedTools = Array.from(new Set(recommendedTools))
  return deduplicatedTools
}

const buildToolPlan = (
  route: AgrotraceRoute,
  userText: string,
): Array<string> => {
  const recommendedTools = getRecommendedTools(route)
  const normalizedText = normalizeText(userText)
  const countRequest = isCountRequest(normalizedText)

  const preferredTools = countRequest
    ? [
        'agrotrace_kpi_snapshot',
        ...recommendedTools.filter(
          (toolName) => toolName !== 'agrotrace_search_entities',
        ),
      ]
    : recommendedTools

  const deduplicatedTools = Array.from(new Set(preferredTools))

  const toolPlan: Array<string> = []
  toolPlan.push(`preferred_tools=${deduplicatedTools.join(',')}`)

  if (route.missingScope.length > 0) {
    toolPlan.push('execution_mode=ask_scope_first')
    return toolPlan
  }

  toolPlan.push('execution_mode=tool_first')
  toolPlan.push('list_limit_default=50')

  if (countRequest) {
    toolPlan.push('count_mode=aggregate_first')
    toolPlan.push('response_style=count_total_short')
    toolPlan.push('list_records=only_on_explicit_request')
  }

  if (route.intent === 'acao') {
    toolPlan.push('write_actions=blocked_read_only')
  }

  return toolPlan
}

const buildSkillPlan = (userText: string): Array<string> => {
  const normalizedText = normalizeText(userText)
  const recommendedSkills = getRecommendedSkills(normalizedText)

  if (recommendedSkills.length === 0) {
    return ['preferred_skills=none']
  }

  return [
    `preferred_skills=${recommendedSkills.join(',')}`,
    'skill_mode=artifact_generation',
  ]
}

export const buildAgrotraceCoordinatorPrompt = (userText: string): string => {
  const route = classifyAgrotraceRoute(userText)
  const toolPlan = buildToolPlan(route, userText)
  const skillPlan = buildSkillPlan(userText)
  const scopeInstruction =
    route.missingScope.length > 0
      ? `Antes de consultas amplas, solicite explicitamente ${route.missingScope.join(' e ')}.`
      : 'Use os filtros de escopo presentes na pergunta antes de consultar dados.'

  return [
    '<mari_coordinator>',
    'Voce e a Mari, assistente operacional do Agrotrace.',
    'Objetivo: responder com precisao para Propriedades, Atendimentos, Questionarios e Safras.',
    'Regras obrigatorias:',
    '- Sempre respeite escopo de tenant e permissao (certificadoraId e usuarioId).',
    '- Para fatos operacionais atuais, use tools MCP antes de concluir.',
    '- Nao invente IDs, status, datas ou contagens.',
    '- Se faltar contexto, diga exatamente qual filtro falta e por que.',
    '- Responda em pt-BR com objetividade e foco operacional.',
    '- Use preferencialmente as tools de dominio Agrotrace recomendadas para esta rota.',
    '- Em perguntas de quantidade/total, priorize agregados (kpi_snapshot) e nao use lista limitada como total.',
    '- Em perguntas de quantidade/total, responda com total e contexto curto; nao liste registros salvo pedido explicito.',
    '- Quando o usuario pedir exportacao (PDF, planilha, grafico), use skills de artefato e gere arquivo final com caminho claro.',
    '- Quando gerar arquivo em .output/reports, devolva links de acesso: /api/assets?name=<arquivo> (visualizar) e /api/assets?name=<arquivo>&download=1 (baixar).',
    '- Para imagens geradas (png/jpg/svg), inclua tambem markdown de preview: ![titulo](/api/assets?name=<arquivo>).',
    INTENT_INSTRUCTIONS[route.intent],
    DOMAIN_INSTRUCTIONS[route.domain],
    scopeInstruction,
    '</mari_coordinator>',
    '<routing>',
    formatRouteMetadata(route),
    '</routing>',
    '<tool_plan>',
    ...toolPlan,
    '</tool_plan>',
    '<skill_plan>',
    ...skillPlan,
    '</skill_plan>',
    '<user_request>',
    userText,
    '</user_request>',
  ].join('\n')
}
