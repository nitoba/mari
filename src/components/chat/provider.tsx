'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useChat } from '@ai-sdk/react'
import { useNavigate } from '@tanstack/react-router'
import { DefaultChatTransport } from 'ai'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import {
  chatConversationMessagesQueryOptions,
  chatConversationsQueryOptions,
  chatQueryKeys,
  createChatConversationMutation,
  deleteChatConversationMutation,
  renameChatConversationMutation,
} from './queries'
import type { ReactNode } from 'react'
import type { UIMessage } from 'ai'
import type { ChatConversationSummary } from './types'

type ChatHelpers = ReturnType<typeof useChat>
type ChatMessage = ChatHelpers['messages'][number]

type ChatConversation = ChatConversationSummary & {
  messages: ChatHelpers['messages']
  isPersisted: boolean
}

type ChatContextValue = {
  messages: ChatHelpers['messages']
  status: ChatHelpers['status']
  error: ChatHelpers['error']
  userQuery: string
  setUserQuery: (query: string) => void
  submitUserQuery: () => void
  isLoading: boolean
  isCreatingConversation: boolean
  isRenamingConversation: boolean
  isDeletingConversation: boolean
  conversationHistory: Array<ChatConversationSummary>
  activeConversationId: string
  activeConversationTitle: string
  createNewConversation: () => void
  renameConversation: (conversationId: string, title: string) => void
  deleteConversation: (conversationId: string) => void
  selectConversation: (conversationId: string) => void
}

const DEFAULT_CONVERSATION_TITLE = 'New chat'

const isTextMessagePart = (
  part: UIMessage['parts'][number],
): part is Extract<UIMessage['parts'][number], { type: 'text' }> =>
  part.type === 'text'

const getMessageText = (message: ChatMessage): string =>
  message.parts
    .filter(isTextMessagePart)
    .map((part) => part.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

const deriveConversationTitle = (messages: ChatHelpers['messages']): string => {
  const firstUserMessage = messages.find((message) => message.role === 'user')
  if (!firstUserMessage) return DEFAULT_CONVERSATION_TITLE

  const title = getMessageText(firstUserMessage)
  if (!title) return DEFAULT_CONVERSATION_TITLE

  return title.length > 42 ? `${title.slice(0, 42).trimEnd()}...` : title
}

const deriveConversationPreview = (
  messages: ChatHelpers['messages'],
): string | null => {
  if (messages.length === 0) return null

  const lastMessage = messages[messages.length - 1]
  const preview = getMessageText(lastMessage)

  return preview || null
}

const hasSameMessageReferences = (
  first: ChatHelpers['messages'],
  second: ChatHelpers['messages'],
): boolean =>
  first.length === second.length &&
  first.every((message, index) => message === second[index])

const sortConversationSummaries = (
  conversations: Array<ChatConversationSummary>,
): Array<ChatConversationSummary> =>
  [...conversations].sort((first, second) => second.updatedAt - first.updatedAt)

const ChatContext = createContext<ChatContextValue | null>(null)

export type ChatProviderProps = {
  conversationId: string
  children: ReactNode
}

export function ChatProvider({ conversationId, children }: ChatProviderProps) {
  const [conversations, setConversations] = useState<Array<ChatConversation>>(
    [],
  )
  const [activeConversationId, setActiveConversationId] = useState(
    () => conversationId,
  )
  const [userQuery, setUserQuery] = useState('')
  const activeConversationIdRef = useRef(activeConversationId)
  const skipNextConversationSyncRef = useRef(false)
  const didHydrateConversationsRef = useRef(false)

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

  const makeRequestId = () => crypto.randomUUID()
  const makeConversationId = () => crypto.randomUUID()

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({
          sessionId: activeConversationIdRef.current,
          requestId: makeRequestId(),
        }),
      }),
    [],
  )

  const {
    messages,
    sendMessage,
    status,
    error,
    setMessages,
    stop,
    clearError,
  } = useChat({
    transport,
    messages: [],
  })

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const navigateToConversation = useCallback(
    (nextConversationId: string, replace = false) => {
      void navigate({
        to: '/chat/$chatId',
        params: { chatId: nextConversationId },
        replace,
      })
    },
    [navigate],
  )

  const createConversationMutation = useMutation({
    mutationFn: (input: { title?: string; conversationId?: string }) =>
      createChatConversationMutation(input),
  })

  const renameConversationMutation = useMutation({
    mutationFn: (input: { conversationId: string; title: string }) =>
      renameChatConversationMutation(input),
  })

  const deleteConversationMutation = useMutation({
    mutationFn: (input: { conversationId: string }) =>
      deleteChatConversationMutation(input),
  })

  const isCreatingConversation = createConversationMutation.isPending
  const isRenamingConversation = renameConversationMutation.isPending
  const isDeletingConversation = deleteConversationMutation.isPending

  const { data: remoteConversations = [], isPending: isConversationsPending } =
    useQuery(chatConversationsQueryOptions())

  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId,
      ),
    [activeConversationId, conversations],
  )

  const shouldFetchActiveConversationMessages =
    activeConversation?.isPersisted &&
    activeConversation.messageCount > 0 &&
    activeConversation.messages.length === 0

  const { data: activeConversationMessages } = useQuery({
    ...chatConversationMessagesQueryOptions(activeConversation?.id ?? ''),
    enabled: shouldFetchActiveConversationMessages,
  })

  useEffect(() => {
    if (conversationId === activeConversationId) return

    setActiveConversationId(conversationId)

    const routeConversation = conversations.find(
      (conversation) => conversation.id === conversationId,
    )

    if (!routeConversation) return
    if (hasSameMessageReferences(routeConversation.messages, messages)) return

    skipNextConversationSyncRef.current = true
    setMessages(routeConversation.messages)
  }, [
    activeConversationId,
    conversationId,
    conversations,
    messages,
    setMessages,
  ])

  useEffect(() => {
    if (didHydrateConversationsRef.current) return
    if (isConversationsPending) return

    didHydrateConversationsRef.current = true

    if (remoteConversations.length === 0) return

    const hydratedConversations: Array<ChatConversation> =
      remoteConversations.map((conversation) => ({
        ...conversation,
        messages: [],
        isPersisted: true,
      }))

    hydratedConversations.sort(
      (first, second) => second.updatedAt - first.updatedAt,
    )

    const requestedConversation = hydratedConversations.find(
      (conversation) => conversation.id === conversationId,
    )
    const nextActiveConversation =
      requestedConversation ?? hydratedConversations[0]

    setConversations(hydratedConversations)

    setActiveConversationId(nextActiveConversation.id)

    if (nextActiveConversation.id !== conversationId) {
      navigateToConversation(nextActiveConversation.id, true)
    }

    setUserQuery('')
    skipNextConversationSyncRef.current = true
    setMessages(nextActiveConversation.messages)
  }, [
    conversationId,
    isConversationsPending,
    navigateToConversation,
    remoteConversations,
    setMessages,
  ])

  useEffect(() => {
    if (!activeConversationMessages) return

    setConversations((previousConversations) =>
      previousConversations.map((conversation) => {
        if (conversation.id !== activeConversation?.id) return conversation
        if (
          hasSameMessageReferences(
            conversation.messages,
            activeConversationMessages,
          )
        ) {
          return conversation
        }

        return {
          ...conversation,
          messages: activeConversationMessages,
          preview: deriveConversationPreview(activeConversationMessages),
          messageCount: activeConversationMessages.length,
        }
      }),
    )

    skipNextConversationSyncRef.current = true
    setMessages(activeConversationMessages)
  }, [activeConversation?.id, activeConversationMessages, setMessages])

  useEffect(() => {
    if (skipNextConversationSyncRef.current) {
      skipNextConversationSyncRef.current = false
      return
    }

    setConversations((previousConversations) => {
      const nextConversations = previousConversations.map((conversation) => {
        if (conversation.id !== activeConversationId) return conversation
        if (hasSameMessageReferences(conversation.messages, messages)) {
          return conversation
        }

        return {
          ...conversation,
          messages,
          title: deriveConversationTitle(messages),
          preview: deriveConversationPreview(messages),
          messageCount: messages.length,
          updatedAt: Date.now(),
        }
      })

      return [...nextConversations].sort(
        (first, second) => second.updatedAt - first.updatedAt,
      )
    })
  }, [activeConversationId, messages])

  const submitUserQuery = useCallback(() => {
    const nextQuery = userQuery.trim()
    if (!nextQuery) return

    sendMessage({ text: nextQuery })
    setUserQuery('')
  }, [sendMessage, userQuery])

  const createNewConversation = useCallback(() => {
    if (isCreatingConversation) return

    stop()
    clearError()

    // ✅ idempotência: client gera um conversationId fixo para esta criação
    const clientConversationId = makeConversationId()

    createConversationMutation.mutate(
      {
        title: DEFAULT_CONVERSATION_TITLE,
        conversationId: clientConversationId,
      },
      {
        onSuccess: (createdConversation) => {
          toast.success('Conversation created')

          queryClient.setQueryData<Array<ChatConversationSummary>>(
            chatQueryKeys.conversations(),
            (previousConversations) =>
              sortConversationSummaries([
                createdConversation,
                ...(previousConversations ?? []).filter(
                  (conversation) => conversation.id !== createdConversation.id,
                ),
              ]),
          )
          queryClient.setQueryData(
            chatQueryKeys.conversationMessages(createdConversation.id),
            [],
          )

          void queryClient.invalidateQueries({
            queryKey: chatQueryKeys.conversations(),
            refetchType: 'inactive',
          })

          const nextConversation: ChatConversation = {
            ...createdConversation,
            messages: [],
            isPersisted: true,
          }

          setConversations((previousConversations) =>
            [
              nextConversation,
              ...previousConversations.filter(
                (conversation) => conversation.id !== nextConversation.id,
              ),
            ].sort((first, second) => second.updatedAt - first.updatedAt),
          )

          setActiveConversationId(nextConversation.id)
          setUserQuery('')
          skipNextConversationSyncRef.current = true
          setMessages([])
          navigateToConversation(nextConversation.id)
        },
        onError: () => {
          toast.error('Could not create conversation')
        },
      },
    )
  }, [
    clearError,
    createConversationMutation,
    isCreatingConversation,
    navigateToConversation,
    queryClient,
    setMessages,
    stop,
  ])

  const renameConversation = useCallback(
    (targetConversationId: string, title: string) => {
      if (isRenamingConversation) return

      const nextTitle = title.trim()
      if (!nextTitle) {
        toast.error('Conversation title is required')
        return
      }

      renameConversationMutation.mutate(
        { conversationId: targetConversationId, title: nextTitle },
        {
          onSuccess: (renamedConversation) => {
            toast.success('Conversation renamed')

            void queryClient.invalidateQueries({
              queryKey: chatQueryKeys.conversations(),
            })

            setConversations((previousConversations) =>
              previousConversations
                .map((conversation) =>
                  conversation.id === renamedConversation.id
                    ? {
                        ...conversation,
                        ...renamedConversation,
                      }
                    : conversation,
                )
                .sort((first, second) => second.updatedAt - first.updatedAt),
            )
          },
          onError: () => {
            toast.error('Could not rename conversation')
          },
        },
      )
    },
    [isRenamingConversation, queryClient, renameConversationMutation],
  )

  const deleteConversation = useCallback(
    (targetConversationId: string) => {
      if (isDeletingConversation) return

      const remainingConversations = conversations.filter(
        (conversation) => conversation.id !== targetConversationId,
      )
      const fallbackConversation = remainingConversations[0]
      const nextConversations =
        remainingConversations.length > 0
          ? remainingConversations
          : [fallbackConversation]

      deleteConversationMutation.mutate(
        { conversationId: targetConversationId },
        {
          onSuccess: () => {
            toast.success('Conversation deleted')

            void queryClient.invalidateQueries({
              queryKey: chatQueryKeys.conversations(),
            })
            queryClient.removeQueries({
              queryKey:
                chatQueryKeys.conversationMessages(targetConversationId),
            })

            setConversations(nextConversations)

            if (activeConversationId !== targetConversationId) return

            setActiveConversationId(fallbackConversation.id)
            setUserQuery('')
            skipNextConversationSyncRef.current = true
            setMessages(fallbackConversation.messages)
            navigateToConversation(fallbackConversation.id, true)
          },
          onError: () => {
            toast.error('Could not delete conversation')
          },
        },
      )
    },
    [
      activeConversationId,
      conversations,
      deleteConversationMutation,
      isDeletingConversation,
      navigateToConversation,
      queryClient,
      setMessages,
    ],
  )

  const selectConversation = useCallback(
    (targetConversationId: string) => {
      if (targetConversationId === activeConversationId) return

      const nextConversation = conversations.find(
        (conversation) => conversation.id === targetConversationId,
      )
      if (!nextConversation) return

      stop()
      clearError()

      setUserQuery('')
      setActiveConversationId(targetConversationId)

      skipNextConversationSyncRef.current = true
      setMessages(nextConversation.messages)
      navigateToConversation(targetConversationId)
    },
    [
      activeConversationId,
      clearError,
      conversations,
      navigateToConversation,
      setMessages,
      stop,
    ],
  )

  const isLoading = status === 'submitted' || status === 'streaming'

  const conversationHistory = useMemo<Array<ChatConversationSummary>>(
    () =>
      conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        preview: conversation.preview,
        messageCount: conversation.messageCount,
      })),
    [conversations],
  )

  const activeConversationTitle = activeConversation?.title ?? ''

  const value = useMemo<ChatContextValue>(
    () => ({
      messages,
      status,
      error,
      userQuery,
      setUserQuery,
      submitUserQuery,
      isLoading,
      isCreatingConversation,
      isRenamingConversation,
      isDeletingConversation,
      conversationHistory,
      activeConversationId,
      activeConversationTitle,
      createNewConversation,
      renameConversation,
      deleteConversation,
      selectConversation,
    }),
    [
      messages,
      status,
      error,
      userQuery,
      submitUserQuery,
      isLoading,
      isCreatingConversation,
      isRenamingConversation,
      isDeletingConversation,
      conversationHistory,
      activeConversationId,
      activeConversationTitle,
      createNewConversation,
      renameConversation,
      deleteConversation,
      selectConversation,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChatContext() {
  const context = useContext(ChatContext)

  if (!context) {
    throw new Error('useChatContext must be used within ChatProvider')
  }

  return context
}
