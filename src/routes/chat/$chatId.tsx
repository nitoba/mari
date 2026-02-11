import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  ChatContent,
  chatConversationMessagesQueryOptions,
  chatConversationsQueryOptions,
} from '@/components/chat'

export const Route = createFileRoute('/chat/$chatId')({
  loader: async ({ context, params }) => {
    let conversations = await context.queryClient.ensureQueryData(
      chatConversationsQueryOptions(),
    )

    let selectedConversation = conversations.find(
      (conversation) => conversation.id === params.chatId,
    )

    console.log('selectedConversation', selectedConversation)

    if (!selectedConversation) {
      conversations = await context.queryClient.fetchQuery(
        chatConversationsQueryOptions(),
      )

      selectedConversation = conversations.find(
        (conversation) => conversation.id === params.chatId,
      )
    }

    if (!selectedConversation) {
      throw redirect({
        to: '/chat',
        replace: true,
      })
    }

    await context.queryClient.ensureQueryData(
      chatConversationMessagesQueryOptions(selectedConversation.id),
    )
  },
  component: ChatConversationPage,
})

function ChatConversationPage() {
  return <ChatContent />
}
