import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { MessageSquare, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  ChatSidebarView,
  chatConversationsQueryOptions,
  chatQueryKeys,
  createChatConversationMutation,
} from '@/components/chat'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

const DEFAULT_CONVERSATION_TITLE = 'New chat'

export const Route = createFileRoute('/chat/')({
  loader: async ({ context }) => {
    const conversations = await context.queryClient.ensureQueryData(
      chatConversationsQueryOptions(),
    )

    return { conversations }
  },
  component: ChatIndexPage,
})

function ChatIndexPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: conversations = [] } = useQuery(chatConversationsQueryOptions())

  const createConversationMutation = useMutation({
    mutationFn: (input: { title?: string }) =>
      createChatConversationMutation(input),
  })

  const handleCreateConversation = () => {
    if (createConversationMutation.isPending) return

    createConversationMutation.mutate(
      { title: DEFAULT_CONVERSATION_TITLE },
      {
        onSuccess: (createdConversation) => {
          toast.success('Conversation created')

          queryClient.setQueryData(
            chatQueryKeys.conversations(),
            (
              previousConversations:
                | Array<{ id: string; title: string; updatedAt: number }>
                | undefined,
            ) =>
              [
                createdConversation,
                ...(previousConversations ?? []).filter(
                  (conversation) => conversation.id !== createdConversation.id,
                ),
              ].sort((a, b) => b.updatedAt - a.updatedAt),
          )

          void queryClient.invalidateQueries({
            queryKey: chatQueryKeys.conversations(),
          })

          void navigate({
            to: '/chat/$chatId',
            params: { chatId: createdConversation.id },
          })
        },
        onError: () => {
          toast.error('Could not create conversation')
        },
      },
    )
  }

  const handleSelectConversation = (conversationId: string) => {
    void navigate({
      to: '/chat/$chatId',
      params: { chatId: conversationId },
    })
  }

  const isEmpty = conversations.length === 0

  return (
    <SidebarProvider>
      <ChatSidebarView
        conversations={conversations}
        onCreateConversation={handleCreateConversation}
        onSelectConversation={handleSelectConversation}
        onRenameConversation={() => {}}
        onDeleteConversation={() => {}}
        isCreatingConversation={createConversationMutation.isPending}
        isRenamingConversation={false}
        isDeletingConversation={false}
        hideActions
      />
      <SidebarInset>
        <div className="flex h-screen flex-col items-center justify-center gap-6 p-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
              <MessageSquare className="text-primary h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Bem-vindo ao Mari AI
              </h1>
              <p className="text-muted-foreground max-w-sm">
                Selecione uma conversa na barra lateral ou crie uma nova para
                começar.
              </p>
            </div>
          </div>
          <Button
            size="lg"
            onClick={handleCreateConversation}
            disabled={createConversationMutation.isPending}
            className="gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            {createConversationMutation.isPending
              ? 'Criando...'
              : isEmpty
                ? 'Criar primeira conversa'
                : 'Nova conversa'}
          </Button>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
