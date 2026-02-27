import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AssistantMessageEvent } from '@mariozechner/pi-ai'
import type {
  StreamState,
  UIStreamWriteEvent,
  ToolCallInfo,
  UIMessageStreamWriter,
} from './types'

export const createChunkId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const getUnknownErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unexpected pi agent error.'
}

const toObjectRecord = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return value
  return { value }
}

export const toToolInput = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return value
  if (value === undefined) return {}
  return { value }
}

const extractToolContentText = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null

  const text = value
    .map((part) => {
      if (!isRecord(part)) return null
      if (part.type !== 'text') return null
      if (typeof part.text !== 'string') return null
      return part.text
    })
    .filter((part): part is string => part !== null)
    .join('\n')
    .trim()

  return text || null
}

export const toToolOutput = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) return { value }

  const details = value.details
  const serializedDetails =
    details === undefined ? undefined : toObjectRecord(details)
  const contentText = extractToolContentText(value.content)

  if (serializedDetails && contentText) {
    return {
      ...serializedDetails,
      content: contentText,
    }
  }

  if (serializedDetails) {
    return serializedDetails
  }

  if (contentText) {
    return { content: contentText }
  }

  return value
}

export const getToolErrorText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message

  if (isRecord(value)) {
    if (typeof value.error === 'string') return value.error
    if (typeof value.message === 'string') return value.message

    const contentText = extractToolContentText(value.content)
    if (contentText) return contentText
  }

  return 'Tool execution failed.'
}

const mapStopReasonToFinishReason = (
  reason: 'stop' | 'length' | 'toolUse' | 'aborted' | 'error' | undefined,
): UIStreamWriteEvent extends { type: 'finish'; finishReason: infer R }
  ? R
  : 'stop' => {
  if (reason === 'stop') return 'stop' as any
  if (reason === 'length') return 'length' as any
  if (reason === 'toolUse') return 'tool-calls' as any
  if (reason === 'aborted' || reason === 'error') return 'error' as any
  return 'other' as any
}

const getToolCallFromPartial = (
  assistantMessageEvent: Extract<
    AssistantMessageEvent,
    { type: 'toolcall_start' | 'toolcall_delta' }
  >,
): ToolCallInfo | null => {
  const contentPart =
    assistantMessageEvent.partial.content[assistantMessageEvent.contentIndex]

  if (contentPart.type !== 'toolCall') {
    return null
  }

  return {
    toolCallId: contentPart.id,
    toolName: contentPart.name,
  }
}

const ensureTextPartStarted = (
  state: StreamState,
  writer: UIMessageStreamWriter,
  contentIndex: number,
): string => {
  const existingId = state.textPartIds.get(contentIndex)
  if (existingId) return existingId

  const textPartId = createChunkId(`text-${contentIndex}`)
  state.textPartIds.set(contentIndex, textPartId)
  writer.write({ type: 'text-start', id: textPartId })
  return textPartId
}

const ensureReasoningPartStarted = (
  state: StreamState,
  writer: UIMessageStreamWriter,
  contentIndex: number,
): string => {
  const existingId = state.reasoningPartIds.get(contentIndex)
  if (existingId) return existingId

  const reasoningPartId = createChunkId(`reasoning-${contentIndex}`)
  state.reasoningPartIds.set(contentIndex, reasoningPartId)
  writer.write({ type: 'reasoning-start', id: reasoningPartId })
  return reasoningPartId
}

const ensureToolInputStarted = (
  state: StreamState,
  writer: UIMessageStreamWriter,
  toolCallId: string,
  toolName: string,
): void => {
  if (state.startedToolCalls.has(toolCallId)) return

  state.startedToolCalls.add(toolCallId)
  writer.write({
    type: 'tool-input-start',
    toolCallId,
    toolName,
  })
}

const ensureToolInputAvailable = (
  state: StreamState,
  writer: UIMessageStreamWriter,
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
): void => {
  if (state.availableToolCalls.has(toolCallId)) return

  state.availableToolCalls.add(toolCallId)
  writer.write({
    type: 'tool-input-available',
    toolCallId,
    toolName,
    input,
  })
}

export const createInitialStreamState = (): StreamState => ({
  finishReason: 'stop',
  openSteps: 0,
  textPartIds: new Map<number, string>(),
  reasoningPartIds: new Map<number, string>(),
  toolCallInfoByContentIndex: new Map<number, ToolCallInfo>(),
  toolNamesByCallId: new Map<string, string>(),
  toolInputsByCallId: new Map<string, Record<string, unknown>>(),
  startedToolCalls: new Set<string>(),
  availableToolCalls: new Set<string>(),
})

export const writerTap = (
  writer: UIMessageStreamWriter,
  sink: Array<UIStreamWriteEvent>,
) => ({
  write: (evt: UIStreamWriteEvent) => {
    sink.push(evt)
    writer.write(evt as any)
  },
})

export const handleAssistantMessageEvent = (
  state: StreamState,
  writer: { write: (evt: UIStreamWriteEvent) => void },
  assistantMessageEvent: AssistantMessageEvent,
): void => {
  switch (assistantMessageEvent.type) {
    case 'start':
      return

    case 'text_start': {
      const existingId = state.textPartIds.get(
        assistantMessageEvent.contentIndex,
      )
      const textPartId =
        existingId ??
        createChunkId(`text-${assistantMessageEvent.contentIndex}`)
      if (!existingId) {
        state.textPartIds.set(assistantMessageEvent.contentIndex, textPartId)
        writer.write({ type: 'text-start', id: textPartId })
      }
      return
    }

    case 'text_delta': {
      const textPartId = ensureTextPartStarted(
        state,
        writer as any,
        assistantMessageEvent.contentIndex,
      )
      writer.write({
        type: 'text-delta',
        id: textPartId,
        delta: assistantMessageEvent.delta,
      })
      return
    }

    case 'text_end': {
      const textPartId = ensureTextPartStarted(
        state,
        writer as any,
        assistantMessageEvent.contentIndex,
      )
      writer.write({ type: 'text-end', id: textPartId })
      state.textPartIds.delete(assistantMessageEvent.contentIndex)
      return
    }

    case 'thinking_start': {
      const existingId = state.reasoningPartIds.get(
        assistantMessageEvent.contentIndex,
      )
      const reasoningPartId =
        existingId ??
        createChunkId(`reasoning-${assistantMessageEvent.contentIndex}`)
      if (!existingId) {
        state.reasoningPartIds.set(
          assistantMessageEvent.contentIndex,
          reasoningPartId,
        )
        writer.write({ type: 'reasoning-start', id: reasoningPartId })
      }
      return
    }

    case 'thinking_delta': {
      const reasoningPartId = ensureReasoningPartStarted(
        state,
        writer as any,
        assistantMessageEvent.contentIndex,
      )
      writer.write({
        type: 'reasoning-delta',
        id: reasoningPartId,
        delta: assistantMessageEvent.delta,
      })
      return
    }

    case 'thinking_end': {
      const reasoningPartId = ensureReasoningPartStarted(
        state,
        writer as any,
        assistantMessageEvent.contentIndex,
      )
      writer.write({ type: 'reasoning-end', id: reasoningPartId })
      state.reasoningPartIds.delete(assistantMessageEvent.contentIndex)
      return
    }

    case 'toolcall_start': {
      const toolCallInfo = getToolCallFromPartial(assistantMessageEvent) ?? {
        toolCallId: createChunkId(`tool-${assistantMessageEvent.contentIndex}`),
        toolName: 'tool',
      }

      state.toolCallInfoByContentIndex.set(
        assistantMessageEvent.contentIndex,
        toolCallInfo,
      )
      state.toolNamesByCallId.set(
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )
      ensureToolInputStarted(
        state,
        writer as any,
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )
      return
    }

    case 'toolcall_delta': {
      const toolCallInfo = state.toolCallInfoByContentIndex.get(
        assistantMessageEvent.contentIndex,
      ) ??
        getToolCallFromPartial(assistantMessageEvent) ?? {
          toolCallId: createChunkId(
            `tool-${assistantMessageEvent.contentIndex}`,
          ),
          toolName: 'tool',
        }

      state.toolCallInfoByContentIndex.set(
        assistantMessageEvent.contentIndex,
        toolCallInfo,
      )
      state.toolNamesByCallId.set(
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )

      ensureToolInputStarted(
        state,
        writer as any,
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )

      writer.write({
        type: 'tool-input-delta',
        toolCallId: toolCallInfo.toolCallId,
        inputTextDelta: assistantMessageEvent.delta,
      })
      return
    }

    case 'toolcall_end': {
      const toolInput = toToolInput(assistantMessageEvent.toolCall.arguments)
      const toolCallInfo: ToolCallInfo = {
        toolCallId: assistantMessageEvent.toolCall.id,
        toolName: assistantMessageEvent.toolCall.name,
      }

      state.toolCallInfoByContentIndex.set(
        assistantMessageEvent.contentIndex,
        toolCallInfo,
      )
      state.toolNamesByCallId.set(
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )
      state.toolInputsByCallId.set(toolCallInfo.toolCallId, toolInput)

      ensureToolInputStarted(
        state,
        writer as any,
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )
      ensureToolInputAvailable(
        state,
        writer as any,
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
        toolInput,
      )
      return
    }

    case 'done': {
      state.finishReason = mapStopReasonToFinishReason(
        assistantMessageEvent.reason,
      )
      return
    }

    case 'error': {
      state.finishReason = mapStopReasonToFinishReason(
        assistantMessageEvent.reason,
      )
      writer.write({
        type: 'error',
        errorText:
          assistantMessageEvent.error.errorMessage ?? 'Assistant error.',
      })
      return
    }
  }
}

export const handleSessionEvent = (
  state: StreamState,
  writer: { write: (evt: UIStreamWriteEvent) => void },
  event: AgentSessionEvent,
): void => {
  switch (event.type) {
    case 'turn_start': {
      state.textPartIds.clear()
      state.reasoningPartIds.clear()
      state.toolCallInfoByContentIndex.clear()
      state.startedToolCalls.clear()
      state.availableToolCalls.clear()
      state.toolNamesByCallId.clear()
      state.toolInputsByCallId.clear()
      writer.write({ type: 'start-step' })
      state.openSteps += 1
      return
    }

    case 'turn_end': {
      if (state.openSteps > 0) {
        writer.write({ type: 'finish-step' })
        state.openSteps -= 1
      }
      state.textPartIds.clear()
      state.reasoningPartIds.clear()
      state.toolCallInfoByContentIndex.clear()
      state.startedToolCalls.clear()
      state.availableToolCalls.clear()
      state.toolNamesByCallId.clear()
      state.toolInputsByCallId.clear()
      return
    }

    case 'message_update': {
      handleAssistantMessageEvent(state, writer, event.assistantMessageEvent)
      return
    }

    case 'tool_execution_start': {
      const toolInput = toToolInput(event.args)
      const toolName =
        state.toolNamesByCallId.get(event.toolCallId) ?? event.toolName

      state.toolNamesByCallId.set(event.toolCallId, toolName)
      state.toolInputsByCallId.set(event.toolCallId, toolInput)

      ensureToolInputStarted(state, writer as any, event.toolCallId, toolName)
      ensureToolInputAvailable(
        state,
        writer as any,
        event.toolCallId,
        toolName,
        toolInput,
      )
      return
    }

    case 'tool_execution_end': {
      const toolName =
        state.toolNamesByCallId.get(event.toolCallId) ?? event.toolName
      const toolInput = state.toolInputsByCallId.get(event.toolCallId) ?? {}

      ensureToolInputStarted(state, writer as any, event.toolCallId, toolName)
      ensureToolInputAvailable(
        state,
        writer as any,
        event.toolCallId,
        toolName,
        toolInput,
      )

      if (event.isError) {
        state.finishReason = 'error'
        writer.write({
          type: 'tool-output-error',
          toolCallId: event.toolCallId,
          errorText: getToolErrorText(event.result),
        })
        return
      }

      writer.write({
        type: 'tool-output-available',
        toolCallId: event.toolCallId,
        output: toToolOutput(event.result),
      })
      return
    }
  }
}
