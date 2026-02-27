import { access, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from '@mariozechner/pi-coding-agent'
import type {
  AgentSession,
  ResourceDiagnostic,
  ResourceLoader,
  Skill,
} from '@mariozechner/pi-coding-agent'
import type { Model } from '@mariozechner/pi-ai'
import { createMcpGatewayTool } from '@/lib/pi-agent/mcp/tool'
import { createAgrotraceMcpTools } from '@/lib/pi-agent/agrotrace-tools'

export const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number]

export type PiModelSelection = {
  provider?: string
  modelId?: string
  thinkingLevel?: PiThinkingLevel
}

export type PiApiKeyProviderConfig = {
  provider: string
  envVar: string
}

export const PI_API_KEY_PROVIDER_CONFIGS: Array<PiApiKeyProviderConfig> = [
  {
    provider: 'groq',
    envVar: 'GROQ_API_KEY',
  },
  {
    provider: 'zai',
    envVar: 'ZAI_API_KEY',
  },
  {
    provider: 'openrouter',
    envVar: 'OPENROUTER_API_KEY',
  },
]

export type PiModelDescriptor = {
  provider: string
  id: string
  name: string
  reasoning: boolean
  isUsingOAuth: boolean
}

type SessionCache = Map<string, Promise<AgentSession>>

type RuntimeGlobals = typeof globalThis & {
  __mariPiSessionCache?: SessionCache
  __mariPiResourceLoaderPromise?: Promise<ResourceLoader>
}

const runtimeGlobals = globalThis as RuntimeGlobals

const SESSIONS_ROOT = path.join(process.cwd(), '.output', 'pi-agent-sessions')
const mcpGatewayTool = createMcpGatewayTool()
const agrotraceMcpTools = createAgrotraceMcpTools()

const authStorage = AuthStorage.create()
const modelRegistry = new ModelRegistry(authStorage)

const sanitizeConversationId = (conversationId: string): string => {
  const trimmedConversationId = conversationId.trim()
  if (!trimmedConversationId) return 'default'

  return trimmedConversationId.replace(/[^a-zA-Z0-9_-]/g, '-')
}

const getSessionCache = (): SessionCache => {
  if (!runtimeGlobals.__mariPiSessionCache) {
    runtimeGlobals.__mariPiSessionCache = new Map<
      string,
      Promise<AgentSession>
    >()
  }

  return runtimeGlobals.__mariPiSessionCache
}

const normalizeString = (value: string | undefined): string | undefined => {
  if (!value) return undefined

  const trimmedValue = value.trim()
  return trimmedValue || undefined
}

const isFlagEnabled = (
  rawValue: string | undefined,
  defaultValue = true,
): boolean => {
  const normalizedValue = normalizeString(rawValue)
  if (!normalizedValue) return defaultValue

  return !['0', 'false', 'off', 'no'].includes(normalizedValue.toLowerCase())
}

const parseListEnv = (rawValue: string | undefined): Array<string> => {
  const normalizedValue = normalizeString(rawValue)
  if (!normalizedValue) return []

  return normalizedValue
    .split(/[,:\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const pathExists = async (candidatePath: string): Promise<boolean> => {
  try {
    await access(candidatePath)
    return true
  } catch {
    return false
  }
}

const isMcpToolEnabled = (): boolean => {
  return isFlagEnabled(process.env.PI_ENABLE_MCP_TOOL, true)
}

const isAgrotraceToolsEnabled = (): boolean => {
  return isFlagEnabled(process.env.PI_ENABLE_AGROTRACE_TOOLS, true)
}

const isSkillsEnabled = (): boolean =>
  isFlagEnabled(process.env.PI_ENABLE_SKILLS, true)

const getDefaultExternalSkillPaths = (): Array<string> => {
  const homePath = homedir()

  return [
    path.join(homePath, '.config', 'opencode', 'skills'),
    path.join(homePath, '.claude', 'skills'),
  ]
}

const getSkillAllowlist = (): Set<string> =>
  new Set(
    parseListEnv(process.env.PI_SKILL_ALLOWLIST).map((item) =>
      item.toLowerCase(),
    ),
  )

const resolveAdditionalSkillPaths = async (): Promise<Array<string>> => {
  const configuredSkillPaths = parseListEnv(process.env.PI_SKILL_PATHS)
  const skillPathCandidates = [
    ...configuredSkillPaths,
    ...getDefaultExternalSkillPaths(),
  ]

  const resolvedPaths: Array<string> = []
  const seenPaths = new Set<string>()

  for (const candidatePath of skillPathCandidates) {
    const resolvedPath = path.resolve(candidatePath)
    if (seenPaths.has(resolvedPath)) continue
    seenPaths.add(resolvedPath)

    if (await pathExists(resolvedPath)) {
      resolvedPaths.push(resolvedPath)
    }
  }

  return resolvedPaths
}

const buildSkillsOverride = (
  allowlist: Set<string>,
): ((base: {
  skills: Array<Skill>
  diagnostics: Array<ResourceDiagnostic>
}) => {
  skills: Array<Skill>
  diagnostics: Array<ResourceDiagnostic>
}) => {
  if (allowlist.size === 0) {
    return (base) => base
  }

  return (base) => ({
    skills: base.skills.filter((skill) =>
      allowlist.has(skill.name.toLowerCase()),
    ),
    diagnostics: base.diagnostics,
  })
}

const createRuntimeResourceLoader = async (): Promise<ResourceLoader> => {
  const allowlist = getSkillAllowlist()
  const additionalSkillPaths = await resolveAdditionalSkillPaths()
  const enableSkills = isSkillsEnabled()

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    additionalSkillPaths,
    noSkills: !enableSkills,
    skillsOverride: buildSkillsOverride(allowlist),
  })

  await loader.reload()
  return loader
}

const getRuntimeResourceLoader = async (): Promise<ResourceLoader> => {
  if (!runtimeGlobals.__mariPiResourceLoaderPromise) {
    runtimeGlobals.__mariPiResourceLoaderPromise = createRuntimeResourceLoader()
  }

  try {
    return await runtimeGlobals.__mariPiResourceLoaderPromise
  } catch (error) {
    runtimeGlobals.__mariPiResourceLoaderPromise = undefined
    throw error
  }
}

const getSessionCustomTools = () => {
  const sessionTools = []

  if (isMcpToolEnabled()) {
    sessionTools.push(mcpGatewayTool)
  }

  if (isAgrotraceToolsEnabled()) {
    sessionTools.push(...agrotraceMcpTools)
  }

  return sessionTools
}

const formatMissingModelConfigurationError = (): Error => {
  const supportedKeys = PI_API_KEY_PROVIDER_CONFIGS.map(
    (provider) => provider.envVar,
  ).join(', ')

  return new Error(
    `No models available. Configure one of ${supportedKeys} or add credentials to ~/.pi/agent/auth.json (API key or OAuth subscription).`,
  )
}

const applyRuntimeApiKeyOverrides = (): void => {
  for (const provider of PI_API_KEY_PROVIDER_CONFIGS) {
    const apiKey = normalizeString(process.env[provider.envVar])

    if (apiKey) {
      authStorage.setRuntimeApiKey(provider.provider, apiKey)
      continue
    }

    authStorage.removeRuntimeApiKey(provider.provider)
  }
}

const getAvailableModels = (): Array<Model<any>> => {
  applyRuntimeApiKeyOverrides()
  modelRegistry.refresh()
  return modelRegistry.getAvailable()
}

const isSameModel = (
  first: Pick<Model<any>, 'provider' | 'id'>,
  second: Pick<Model<any>, 'provider' | 'id'>,
): boolean => first.provider === second.provider && first.id === second.id

const resolveModelByProviderAndId = (
  availableModels: Array<Model<any>>,
  provider: string,
  modelId: string,
): Model<any> => {
  const availableModel = availableModels.find(
    (model) => model.provider === provider && model.id === modelId,
  )

  if (availableModel) return availableModel

  const knownModel = modelRegistry.find(provider, modelId)
  if (knownModel) {
    throw new Error(
      `Model ${provider}/${modelId} is known but unavailable. Check credentials for provider "${provider}".`,
    )
  }

  throw new Error(`Model ${provider}/${modelId} not found.`)
}

const resolveModelByProvider = (
  availableModels: Array<Model<any>>,
  provider: string,
): Model<any> => {
  const availableModel = availableModels.find(
    (model) => model.provider === provider,
  )

  if (availableModel) return availableModel

  throw new Error(
    `No models available for provider "${provider}". Configure credentials or subscription for this provider.`,
  )
}

const resolveModelById = (
  availableModels: Array<Model<any>>,
  modelId: string,
): Model<any> => {
  const matchingModels = availableModels.filter((model) => model.id === modelId)

  if (matchingModels.length === 1) {
    return matchingModels[0]
  }

  if (matchingModels.length > 1) {
    throw new Error(
      `Model id "${modelId}" is ambiguous. Specify a provider as well.`,
    )
  }

  throw new Error(`No available model found with id "${modelId}".`)
}

const resolveDefaultModel = (
  availableModels: Array<Model<any>>,
): Model<any> => {
  const defaultProvider = normalizeString(process.env.PI_DEFAULT_PROVIDER)
  const defaultModelId = normalizeString(process.env.PI_DEFAULT_MODEL)

  if (defaultProvider && defaultModelId) {
    return resolveModelByProviderAndId(
      availableModels,
      defaultProvider,
      defaultModelId,
    )
  }

  if (defaultProvider) {
    return resolveModelByProvider(availableModels, defaultProvider)
  }

  if (defaultModelId) {
    return resolveModelById(availableModels, defaultModelId)
  }

  for (const provider of PI_API_KEY_PROVIDER_CONFIGS) {
    const providerModel = availableModels.find(
      (model) => model.provider === provider.provider,
    )

    if (providerModel) {
      return providerModel
    }
  }

  return availableModels[0]
}

const resolveModelSelection = (
  availableModels: Array<Model<any>>,
  selection?: PiModelSelection,
): Model<any> => {
  const requestedProvider = normalizeString(selection?.provider)
  const requestedModelId = normalizeString(selection?.modelId)

  if (requestedProvider && requestedModelId) {
    return resolveModelByProviderAndId(
      availableModels,
      requestedProvider,
      requestedModelId,
    )
  }

  if (requestedProvider) {
    return resolveModelByProvider(availableModels, requestedProvider)
  }

  if (requestedModelId) {
    return resolveModelById(availableModels, requestedModelId)
  }

  return resolveDefaultModel(availableModels)
}

const getModelAndThinking = (
  selection?: PiModelSelection,
): {
  model: Model<any>
  thinkingLevel?: PiThinkingLevel
} => {
  const availableModels = getAvailableModels()

  if (availableModels.length === 0) {
    throw formatMissingModelConfigurationError()
  }

  return {
    model: resolveModelSelection(availableModels, selection),
    thinkingLevel: selection?.thinkingLevel,
  }
}

const applySelectionToSession = async (
  session: AgentSession,
  selection?: PiModelSelection,
): Promise<void> => {
  if (!selection?.provider && !selection?.modelId) {
    if (selection?.thinkingLevel) {
      session.setThinkingLevel(selection.thinkingLevel)
    }
    return
  }

  const { model, thinkingLevel } = getModelAndThinking(selection)

  if (!session.model || !isSameModel(session.model, model)) {
    await session.setModel(model)
  }

  if (thinkingLevel) {
    session.setThinkingLevel(thinkingLevel)
  }
}

const createConversationSession = async (
  conversationId: string,
  selection?: PiModelSelection,
): Promise<AgentSession> => {
  const safeConversationId = sanitizeConversationId(conversationId)
  const sessionDirectory = path.join(SESSIONS_ROOT, safeConversationId)
  const { model, thinkingLevel } = getModelAndThinking(selection)
  const resourceLoader = await getRuntimeResourceLoader()

  await mkdir(sessionDirectory, { recursive: true })

  const { session } = await createAgentSession({
    authStorage,
    customTools: getSessionCustomTools(),
    cwd: process.cwd(),
    model,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.continueRecent(
      process.cwd(),
      sessionDirectory,
    ),
    thinkingLevel,
  })

  return session
}

export const getConversationSession = async (
  conversationId: string,
  selection?: PiModelSelection,
): Promise<AgentSession> => {
  const safeConversationId = sanitizeConversationId(conversationId)
  const sessionCache = getSessionCache()
  const cachedSession = sessionCache.get(safeConversationId)

  if (cachedSession) {
    const session = await cachedSession
    await applySelectionToSession(session, selection)
    return session
  }

  const sessionPromise = createConversationSession(
    safeConversationId,
    selection,
  )
  sessionCache.set(safeConversationId, sessionPromise)

  try {
    return await sessionPromise
  } catch (error) {
    sessionCache.delete(safeConversationId)
    throw error
  }
}

export const listAvailablePiModels = (): Array<PiModelDescriptor> =>
  getAvailableModels().map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    isUsingOAuth: modelRegistry.isUsingOAuth(model),
  }))
