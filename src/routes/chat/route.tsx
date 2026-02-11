import { Outlet, createFileRoute, useParams } from '@tanstack/react-router'
import { ChatLayout, ChatProvider } from '@/components/chat'

export const Route = createFileRoute('/chat')({ component: ChatRouteLayout })

function ChatRouteLayout() {
  const params = useParams({ strict: false })
  const chatId = params.chatId

  if (!chatId) {
    return <Outlet />
  }

  return (
    <ChatProvider conversationId={chatId}>
      <ChatLayout>
        <Outlet />
      </ChatLayout>
    </ChatProvider>
  )
}
