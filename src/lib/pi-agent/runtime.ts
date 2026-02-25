import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from '@mariozechner/pi-coding-agent'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { Model } from '@mariozechner/pi-ai'
import { createMcpGatewayTool } from '@/lib/pi-agent/mcp/tool'

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
}

const runtimeGlobals = globalThis as RuntimeGlobals

const SESSIONS_ROOT = path.join(process.cwd(), '.output', 'pi-agent-sessions')
const mcpGatewayTool = createMcpGatewayTool()

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

const isMcpToolEnabled = (): boolean => {
  const mcpToolFlag = normalizeString(process.env.PI_ENABLE_MCP_TOOL)
  if (!mcpToolFlag) return true

  return !['0', 'false', 'off', 'no'].includes(mcpToolFlag.toLowerCase())
}

const getSessionCustomTools = () => (isMcpToolEnabled() ? [mcpGatewayTool] : [])

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

  await mkdir(sessionDirectory, { recursive: true })

  const { session } = await createAgentSession({
    authStorage,
    customTools: getSessionCustomTools(),
    cwd: process.cwd(),
    model,
    modelRegistry,
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
