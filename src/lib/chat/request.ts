import { randomUUID } from 'node:crypto'
import { VALID_THINKING_LEVELS } from './types'
import type { UIMessage } from 'ai'
import type {
  PI_THINKING_LEVELS,
  PiModelSelection,
} from '@/lib/pi-agent/runtime'

export type ParsedChatRequest = {
  sessionId: string
  requestId: string
  messages: Array<UIMessage>
  modelSelection?: PiModelSelection
}

const parseModelSelection = (body: {
  model?: { provider?: string; modelId?: string; thinkingLevel?: string }
}): PiModelSelection | undefined => {
  const requestedModel = body.model
  if (!requestedModel) return undefined

  const normalizedProvider = requestedModel.provider?.trim()
  const normalizedModelId = requestedModel.modelId?.trim()
  const normalizedThinkingLevel = requestedModel.thinkingLevel?.trim()

  const thinkingLevel =
    normalizedThinkingLevel &&
    VALID_THINKING_LEVELS.has(
      normalizedThinkingLevel as (typeof PI_THINKING_LEVELS)[number],
    )
      ? (normalizedThinkingLevel as (typeof PI_THINKING_LEVELS)[number])
      : undefined

  if (!normalizedProvider && !normalizedModelId && !thinkingLevel) {
    return undefined
  }

  return {
    provider: normalizedProvider || undefined,
    modelId: normalizedModelId || undefined,
    thinkingLevel,
  }
}

export const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(
      (part): part is Extract<typeof part, { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.text)
    .join('')
    .trim()

export const parseChatRequest = async (
  request: Request,
): Promise<ParsedChatRequest | { error: string; status: number }> => {
  const body = (await request.json()) as {
    sessionId?: string
    requestId?: string
    messages?: Array<UIMessage>
    model?: { provider?: string; modelId?: string; thinkingLevel?: string }
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  const modelSelection = parseModelSelection(body)

  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId.trim()
      ? body.sessionId.trim()
      : randomUUID()

  const requestId =
    typeof body.requestId === 'string' && body.requestId.trim()
      ? body.requestId.trim()
      : ''

  if (!requestId) {
    return { error: 'Missing requestId', status: 400 }
  }

  return {
    sessionId,
    requestId,
    messages,
    modelSelection,
  }
}
