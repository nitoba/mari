import { randomUUID } from 'node:crypto'
import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { ChatConversationSummary } from './types'

type ChatMessage = {
  id: string
  role: 'system' | 'user' | 'assistant'
  parts: Array<{
    type: 'text'
    text: string
  }>
}

const DEFAULT_CONVERSATION_TITLE = 'New chat'

const chatBaseQueryKey = ['chat'] as const

export const chatQueryKeys = {
  all: chatBaseQueryKey,
  conversations: () => [...chatBaseQueryKey, 'conversations'] as const,
  conversationMessages: (conversationId: string) =>
    [...chatBaseQueryKey, 'conversations', conversationId, 'messages'] as const,
}

let mockConversations: Array<ChatConversationSummary> = [
  {
    id: 'conversation-project-roadmap',
    title: 'Project roadmap discussion',
    updatedAt: Date.UTC(2026, 1, 11, 10, 30, 0),
    preview: 'Vamos priorizar autenticacao e cobranca neste ciclo.',
    messageCount: 4,
  },
  {
    id: 'conversation-api-docs',
    title: 'API documentation review',
    updatedAt: Date.UTC(2026, 1, 10, 14, 0, 0),
    preview: 'Faltam exemplos de erro e limites de rate limit.',
    messageCount: 2,
  },
]

const createTextMessage = (
  id: string,
  role: ChatMessage['role'],
  text: string,
): ChatMessage => ({
  id,
  role,
  parts: [
    {
      type: 'text',
      text,
    },
  ],
})

const mockMessagesByConversationId: Record<string, Array<ChatMessage>> = {
  'conversation-project-roadmap': [
    createTextMessage(
      'message-1',
      'user',
      'Precisamos alinhar o roadmap do proximo trimestre.',
    ),
    createTextMessage(
      'message-2',
      'assistant',
      'Perfeito. Sugiro focar em autenticacao, onboarding e billing.',
    ),
    createTextMessage(
      'message-3',
      'user',
      'Qual ordem voce recomenda para entregar isso com menos risco?',
    ),
    createTextMessage(
      'message-4',
      'assistant',
      'Primeiro autenticacao, depois onboarding e por ultimo billing.',
    ),
  ],
  'conversation-api-docs': [
    createTextMessage(
      'message-5',
      'user',
      'A documentacao da API esta clara para integracoes externas?',
    ),
    createTextMessage(
      'message-6',
      'assistant',
      'A estrutura esta boa, mas faltam exemplos de erro e retry.',
    ),
  ],
}

const sortConversations = (
  conversations: Array<ChatConversationSummary>,
): Array<ChatConversationSummary> =>
  [...conversations].sort((first, second) => second.updatedAt - first.updatedAt)

const getConversationsServerFn = createServerFn({ method: 'GET' }).handler(() =>
  sortConversations(mockConversations),
)

const getConversationMessagesInput = z.object({
  conversationId: z.string(),
})

const getConversationMessagesServerFn = createServerFn({
  method: 'GET',
})
  .inputValidator(getConversationMessagesInput)
  .handler(
    ({ data }) => mockMessagesByConversationId[data.conversationId] ?? [],
  )

const createConversationInput = z.object({
  title: z.string().trim().min(1).max(80).optional(),
})

const createConversationServerFn = createServerFn({
  method: 'POST',
})
  .inputValidator(createConversationInput)
  .handler(({ data }) => {
    const now = Date.now()
    const conversationId = randomUUID()

    const createdConversation: ChatConversationSummary = {
      id: conversationId,
      title: data.title ?? DEFAULT_CONVERSATION_TITLE,
      updatedAt: now,
      preview: null,
      messageCount: 0,
    }

    mockConversations = sortConversations([
      createdConversation,
      ...mockConversations,
    ])
    mockMessagesByConversationId[conversationId] = []

    return createdConversation
  })

const renameConversationInput = z.object({
  conversationId: z.string(),
  title: z.string().trim().min(1).max(80),
})

const renameConversationServerFn = createServerFn({
  method: 'POST',
})
  .inputValidator(renameConversationInput)
  .handler(({ data }) => {
    const conversationToRename = mockConversations.find(
      (conversation) => conversation.id === data.conversationId,
    )

    if (!conversationToRename) {
      throw new Error('Conversation not found')
    }

    const renamedConversation: ChatConversationSummary = {
      ...conversationToRename,
      title: data.title,
      updatedAt: Date.now(),
    }

    mockConversations = sortConversations(
      mockConversations.map((conversation) =>
        conversation.id === data.conversationId
          ? renamedConversation
          : conversation,
      ),
    )

    return renamedConversation
  })

const deleteConversationInput = z.object({
  conversationId: z.string(),
})

const deleteConversationServerFn = createServerFn({
  method: 'POST',
})
  .inputValidator(deleteConversationInput)
  .handler(({ data }) => {
    const conversationExists = mockConversations.some(
      (conversation) => conversation.id === data.conversationId,
    )

    if (!conversationExists) {
      throw new Error('Conversation not found')
    }

    mockConversations = mockConversations.filter(
      (conversation) => conversation.id !== data.conversationId,
    )
    delete mockMessagesByConversationId[data.conversationId]

    return { conversationId: data.conversationId }
  })

export const chatConversationsQueryOptions = () =>
  queryOptions({
    queryKey: chatQueryKeys.conversations(),
    queryFn: () => getConversationsServerFn(),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

export const chatConversationMessagesQueryOptions = (conversationId: string) =>
  queryOptions({
    queryKey: chatQueryKeys.conversationMessages(conversationId),
    queryFn: () =>
      getConversationMessagesServerFn({ data: { conversationId } }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

export const createChatConversationMutation = (input?: { title?: string }) =>
  createConversationServerFn({ data: input ?? {} })

export const renameChatConversationMutation = (input: {
  conversationId: string
  title: string
}) => renameConversationServerFn({ data: input })

export const deleteChatConversationMutation = (input: {
  conversationId: string
}) => deleteConversationServerFn({ data: input })
