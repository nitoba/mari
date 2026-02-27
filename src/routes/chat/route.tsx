import {
  Outlet,
  createFileRoute,
  redirect,
  useParams,
} from '@tanstack/react-router'
import { ChatLayout, ChatProvider } from '@/components/chat'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/chat')({
  beforeLoad: async () => {
    const session = await authClient.getSession()
    if (!session.data) {
      throw redirect({ to: '/auth/login' })
    }
  },
  component: ChatRouteLayout,
})

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
