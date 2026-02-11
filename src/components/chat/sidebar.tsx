'use client'

import { Pencil, PlusIcon, Search, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../ui/sidebar'
import type { ChatConversationSummary } from '@/components/chat/types'
import { useChatContext } from '@/components/chat/provider'

type ConversationGroup = {
  period: string
  conversations: Array<ChatConversationSummary>
}

const DAY_IN_MS = 24 * 60 * 60 * 1000
const PERIOD_ORDER = [
  'Today',
  'Yesterday',
  'Last 7 days',
  'Last 30 days',
  'Older',
]

const getConversationPeriod = (updatedAt: number): string => {
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()

  const conversationDate = new Date(updatedAt)
  const startOfConversationDay = new Date(
    conversationDate.getFullYear(),
    conversationDate.getMonth(),
    conversationDate.getDate(),
  ).getTime()

  const diffInDays = Math.floor(
    (startOfToday - startOfConversationDay) / DAY_IN_MS,
  )

  if (diffInDays <= 0) return 'Today'
  if (diffInDays === 1) return 'Yesterday'
  if (diffInDays < 7) return 'Last 7 days'
  if (diffInDays < 30) return 'Last 30 days'
  return 'Older'
}

const groupConversationsByPeriod = (
  conversations: Array<ChatConversationSummary>,
): Array<ConversationGroup> => {
  const groupedConversations = new Map<string, Array<ChatConversationSummary>>()

  for (const conversation of conversations) {
    const period = getConversationPeriod(conversation.updatedAt)
    const periodConversations = groupedConversations.get(period)

    if (periodConversations) {
      periodConversations.push(conversation)
      continue
    }

    groupedConversations.set(period, [conversation])
  }

  return PERIOD_ORDER.map((period) => ({
    period,
    conversations: groupedConversations.get(period) ?? [],
  })).filter((group) => group.conversations.length > 0)
}

type ChatSidebarViewProps = {
  conversations: Array<ChatConversationSummary>
  activeConversationId?: string
  onCreateConversation: () => void
  onSelectConversation: (conversationId: string) => void
  onRenameConversation: (conversationId: string, title: string) => void
  onDeleteConversation: (conversationId: string) => void
  isCreatingConversation: boolean
  isRenamingConversation: boolean
  isDeletingConversation: boolean
  hideActions?: boolean
}

export function ChatSidebarView({
  conversations,
  activeConversationId,
  onCreateConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  isCreatingConversation,
  isRenamingConversation,
  isDeletingConversation,
  hideActions = false,
}: ChatSidebarViewProps) {
  const [renameDialogConversation, setRenameDialogConversation] =
    useState<ChatConversationSummary | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteDialogConversation, setDeleteDialogConversation] =
    useState<ChatConversationSummary | null>(null)

  const openRenameDialog = useCallback(
    (conversation: ChatConversationSummary) => {
      setRenameDialogConversation(conversation)
      setRenameTitle(conversation.title)
    },
    [],
  )

  const closeRenameDialog = useCallback(() => {
    setRenameDialogConversation(null)
    setRenameTitle('')
  }, [])

  const submitRename = useCallback(() => {
    if (!renameDialogConversation) return

    const nextTitle = renameTitle.trim()

    if (!nextTitle) {
      toast.error('Conversation title is required')
      return
    }

    if (nextTitle === renameDialogConversation.title) {
      closeRenameDialog()
      return
    }

    onRenameConversation(renameDialogConversation.id, nextTitle)
    closeRenameDialog()
  }, [
    closeRenameDialog,
    onRenameConversation,
    renameDialogConversation,
    renameTitle,
  ])

  const openDeleteDialog = useCallback(
    (conversation: ChatConversationSummary) => {
      setDeleteDialogConversation(conversation)
    },
    [],
  )

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialogConversation(null)
  }, [])

  const confirmDelete = useCallback(() => {
    if (!deleteDialogConversation) return

    onDeleteConversation(deleteDialogConversation.id)
    closeDeleteDialog()
  }, [closeDeleteDialog, onDeleteConversation, deleteDialogConversation])

  const groupedConversations = useMemo(
    () => groupConversationsByPeriod(conversations),
    [conversations],
  )

  return (
    <>
      <Sidebar>
        <SidebarHeader className="flex flex-row items-center justify-between gap-2 px-2 py-4">
          <div className="flex flex-row items-center gap-2 px-2">
            <div className="bg-primary/10 size-8 rounded-md"></div>
            <div className="text-md font-base text-primary tracking-tight">
              Mari AI
            </div>
          </div>
          <Button variant="ghost" className="size-8">
            <Search className="size-4" />
          </Button>
        </SidebarHeader>
        <SidebarContent className="pt-4">
          <div className="px-4">
            <Button
              variant="outline"
              className="mb-4 flex w-full items-center gap-2"
              onClick={onCreateConversation}
              disabled={isCreatingConversation}
            >
              <PlusIcon className="size-4" />
              <span>New Chat</span>
            </Button>
          </div>
          {groupedConversations.map((group) => (
            <SidebarGroup key={group.period}>
              <SidebarGroupLabel>{group.period}</SidebarGroupLabel>
              <SidebarMenu>
                {group.conversations.map((conversation) => (
                  <SidebarMenuItem key={conversation.id}>
                    <SidebarMenuButton
                      isActive={conversation.id === activeConversationId}
                      onClick={() => onSelectConversation(conversation.id)}
                      className="h-auto py-2 pr-12"
                    >
                      <span>{conversation.title}</span>
                    </SidebarMenuButton>
                    {!hideActions && (
                      <>
                        <SidebarMenuAction
                          showOnHover
                          className="right-7"
                          onClick={(event) => {
                            event.stopPropagation()
                            openRenameDialog(conversation)
                          }}
                          disabled={
                            isRenamingConversation || isDeletingConversation
                          }
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">Rename conversation</span>
                        </SidebarMenuAction>
                        <SidebarMenuAction
                          showOnHover
                          className="text-destructive hover:text-destructive"
                          onClick={(event) => {
                            event.stopPropagation()
                            openDeleteDialog(conversation)
                          }}
                          disabled={
                            isRenamingConversation || isDeletingConversation
                          }
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Delete conversation</span>
                        </SidebarMenuAction>
                      </>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </Sidebar>

      {!hideActions && (
        <>
          <Dialog
            open={renameDialogConversation !== null}
            onOpenChange={(open) => {
              if (!open) {
                closeRenameDialog()
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename conversation</DialogTitle>
                <DialogDescription>
                  Update the title shown in your chat history.
                </DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitRename()
                }}
              >
                <Input
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                  placeholder="Conversation title"
                  autoFocus
                  maxLength={80}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeRenameDialog}
                    disabled={isRenamingConversation}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isRenamingConversation}>
                    Save
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={deleteDialogConversation !== null}
            onOpenChange={(open) => {
              if (!open) {
                closeDeleteDialog()
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. The conversation
                  {deleteDialogConversation
                    ? ` "${deleteDialogConversation.title}"`
                    : ''}{' '}
                  will be permanently removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletingConversation}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={isDeletingConversation}
                  onClick={confirmDelete}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </>
  )
}

export function ChatSidebar() {
  const {
    activeConversationId,
    conversationHistory,
    createNewConversation,
    deleteConversation,
    isCreatingConversation,
    isDeletingConversation,
    isRenamingConversation,
    renameConversation,
    selectConversation,
  } = useChatContext()

  return (
    <ChatSidebarView
      conversations={conversationHistory}
      activeConversationId={activeConversationId}
      onCreateConversation={createNewConversation}
      onSelectConversation={selectConversation}
      onRenameConversation={renameConversation}
      onDeleteConversation={deleteConversation}
      isCreatingConversation={isCreatingConversation}
      isRenamingConversation={isRenamingConversation}
      isDeletingConversation={isDeletingConversation}
      hideActions={false}
    />
  )
}
