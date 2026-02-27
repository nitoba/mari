import { createUIMessageStream } from 'ai'
import { createChunkId, getToolErrorText, toToolOutput } from './stream-utils'

type CachedMessage = {
  role: string
  content: unknown
  seq?: number
}

export const createCachedResponseStream = (cached: CachedMessage[]) => {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: 'start' })
      writer.write({ type: 'start-step' })

      const toolResults = cached.filter((m) => m.role === 'toolResult')
      for (const tr of toolResults) {
        const msg = tr.content as any
        const toolCallId =
          msg.toolCallId ?? msg.toolCall?.id ?? `tool-${tr.seq}`

        if (msg.isError) {
          writer.write({
            type: 'tool-output-error',
            toolCallId,
            errorText: getToolErrorText(msg),
          })
        } else {
          writer.write({
            type: 'tool-output-available',
            toolCallId,
            output: toToolOutput(msg),
          })
        }
      }

      const assistantRow = cached.find((m) => m.role === 'assistant')
      const assistantMsg = assistantRow?.content as any

      const text = Array.isArray(assistantMsg?.content)
        ? assistantMsg.content
            .filter(
              (p: any) => p?.type === 'text' && typeof p.text === 'string',
            )
            .map((p: any) => p.text)
            .join('')
            .trim()
        : ''

      if (text) {
        const id = createChunkId('text-cached')
        writer.write({ type: 'text-start', id })
        writer.write({ type: 'text-delta', id, delta: text })
        writer.write({ type: 'text-end', id })
      }

      writer.write({ type: 'finish-step' })
      writer.write({ type: 'finish', finishReason: 'stop' })
    },
  })

  return stream
}

export const createBusyResponseStream = () => {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: 'start' })
      writer.write({ type: 'error', errorText: 'SESSION_BUSY' })
      writer.write({ type: 'finish', finishReason: 'error' })
    },
  })

  return stream
}
