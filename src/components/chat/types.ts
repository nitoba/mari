import type { UIMessage } from 'ai'

export type ChatConversationSummary = {
  id: string
  title: string
  updatedAt: number
  preview: string | null
  messageCount: number
}

export type ChatConversationWithMessages = ChatConversationSummary & {
  messages: Array<UIMessage>
}
