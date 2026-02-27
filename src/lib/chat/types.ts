import type { UIMessage } from 'ai'
import { PI_THINKING_LEVELS } from '@/lib/pi-agent/runtime'

export type ChatRequestBody = {
  sessionId?: string
  requestId?: string
  messages?: Array<UIMessage>
  model?: {
    provider?: string
    modelId?: string
    thinkingLevel?: string
  }
}

export type StreamFinishReason =
  | 'stop'
  | 'length'
  | 'tool-calls'
  | 'error'
  | 'other'

export type ToolCallInfo = {
  toolCallId: string
  toolName: string
}

export type TurnEndEvent = {
  type: 'turn_end'
  message?: unknown
  toolResults?: unknown[]
}

export type StreamState = {
  finishReason: StreamFinishReason
  openSteps: number
  textPartIds: Map<number, string>
  reasoningPartIds: Map<number, string>
  toolCallInfoByContentIndex: Map<number, ToolCallInfo>
  toolNamesByCallId: Map<string, string>
  toolInputsByCallId: Map<string, Record<string, unknown>>
  startedToolCalls: Set<string>
  availableToolCalls: Set<string>
}

export type UIStreamWriteEvent =
  | { type: 'start' }
  | { type: 'start-step' }
  | { type: 'finish-step' }
  | { type: 'finish'; finishReason: StreamFinishReason }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-input-start'; toolCallId: string; toolName: string }
  | {
      type: 'tool-input-available'
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
    }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | {
      type: 'tool-output-available'
      toolCallId: string
      output: Record<string, unknown>
    }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string }
  | { type: 'error'; errorText: string }
  | { type: 'abort'; reason: string }

export type UIMessageStreamWriter = Parameters<
  Parameters<typeof import('ai').createUIMessageStream>[0]['execute']
>[0]['writer']

export const VALID_THINKING_LEVELS = new Set(PI_THINKING_LEVELS)
