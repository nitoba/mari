import { createFileRoute } from '@tanstack/react-router'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import type { UIMessage } from 'ai'

type ChatRequestBody = {
  messages?: Array<UIMessage>
}

type UIMessageStreamWriter = Parameters<
  Parameters<typeof createUIMessageStream>[0]['execute']
>[0]['writer']

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(
      (part): part is Extract<typeof part, { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.text)
    .join('')
    .trim()

const createChunkId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const chunkText = (text: string, chunkSize = 32): Array<string> => {
  if (!text) return []

  const chunks: Array<string> = []

  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize))
  }

  return chunks
}

const writeReasoningPart = async (
  writer: UIMessageStreamWriter,
  text: string,
): Promise<void> => {
  const reasoningId = createChunkId('reasoning')

  await sleep(500)
  writer.write({ type: 'reasoning-start', id: reasoningId })

  for (const delta of chunkText(text, 36)) {
    writer.write({ type: 'reasoning-delta', id: reasoningId, delta })
    await sleep(45)
  }

  writer.write({ type: 'reasoning-end', id: reasoningId })
}

const writeToolCallPart = async (
  writer: UIMessageStreamWriter,
  options: {
    toolName: string
    input: Record<string, unknown>
    output?: Record<string, unknown>
    errorText?: string
  },
): Promise<void> => {
  const toolCallId = createChunkId('tool')
  await sleep(1000)

  writer.write({
    type: 'tool-input-start',
    toolCallId,
    toolName: options.toolName,
  })

  for (const inputTextDelta of chunkText(JSON.stringify(options.input), 22)) {
    writer.write({ type: 'tool-input-delta', toolCallId, inputTextDelta })
    await sleep(600)
  }

  writer.write({
    type: 'tool-input-available',
    toolCallId,
    toolName: options.toolName,
    input: options.input,
  })

  await sleep(500)

  if (options.errorText) {
    writer.write({
      type: 'tool-output-error',
      toolCallId,
      errorText: options.errorText,
    })
    return
  }

  writer.write({
    type: 'tool-output-available',
    toolCallId,
    output: options.output ?? { ok: true },
  })
}

const writeAssistantTextPart = async (
  writer: UIMessageStreamWriter,
  text: string,
): Promise<void> => {
  const textPartId = createChunkId('text')

  writer.write({ type: 'text-start', id: textPartId })

  for (const delta of chunkText(text, 34)) {
    writer.write({ type: 'text-delta', id: textPartId, delta })
    await sleep(40)
  }

  writer.write({ type: 'text-end', id: textPartId })
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatRequestBody
        const messages = Array.isArray(body.messages) ? body.messages : []

        const lastUserMessage = [...messages]
          .reverse()
          .find((message) => message.role === 'user')

        const userText = lastUserMessage ? getMessageText(lastUserMessage) : ''
        const normalizedUserText = userText.toLowerCase()

        const shouldSimulateToolError =
          normalizedUserText.includes('erro') ||
          normalizedUserText.includes('falha')

        const extractedLocation =
          userText.match(/em\s+([\p{L}\s-]+)/iu)?.[1]?.trim() || 'Sao Paulo'

        const docsQuery = userText || 'roadmap de produto'

        const weatherOutput = {
          location: extractedLocation,
          condition: 'ensolarado',
          temperatureC: 27,
          humidity: 54,
        }

        const docsOutput = {
          source: 'knowledge-base-mock',
          hits: [
            {
              id: 'doc-1',
              title: 'Guia de conversa do bot',
            },
            {
              id: 'doc-2',
              title: 'Politica de tool calls',
            },
          ],
        }

        const assistantText = shouldSimulateToolError
          ? `Simulei reasoning + tool calls. A ferramenta de docs retornou erro proposital para teste, mas consegui responder com fallback. Clima em ${extractedLocation}: ${weatherOutput.temperatureC}C e ${weatherOutput.condition}.`
          : `Simulei reasoning + tool calls com sucesso. Consultei clima e base de conhecimento para a sua pergunta "${docsQuery}". Clima em ${extractedLocation}: ${weatherOutput.temperatureC}C e ${weatherOutput.condition}.`

        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            await sleep(3200)
            writer.write({ type: 'start' })
            await sleep(800)
            writer.write({ type: 'start-step' })

            await writeReasoningPart(
              writer,
              'Vou analisar a intencao da mensagem e decidir quais ferramentas chamar primeiro.',
            )

            await sleep(2000)

            await writeToolCallPart(writer, {
              toolName: 'getWeatherInformation',
              input: { location: extractedLocation, unit: 'celsius' },
              output: weatherOutput,
            })

            await sleep(5000)

            await writeToolCallPart(writer, {
              toolName: 'searchKnowledgeBase',
              input: { query: docsQuery, topK: 2 },
              output: docsOutput,
              errorText: shouldSimulateToolError
                ? 'Knowledge base timeout (mock).'
                : undefined,
            })

            writer.write({ type: 'finish-step' })
            writer.write({ type: 'start-step' })

            await sleep(6000)

            await writeReasoningPart(
              writer,
              'Agora vou consolidar os resultados das ferramentas e montar a resposta final para o usuario.',
            )

            await sleep(3000)

            await writeAssistantTextPart(writer, assistantText)

            writer.write({ type: 'finish-step' })
            writer.write({ type: 'finish', finishReason: 'stop' })
          },
        })

        return createUIMessageStreamResponse({ stream })
      },
    },
  },
})
