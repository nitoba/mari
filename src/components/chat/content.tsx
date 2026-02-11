'use client'

import { Chat } from './chat'
import { useChatContext } from './provider'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function ChatContent() {
  const { activeConversationTitle } = useChatContext()

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <header className="bg-background z-10 flex h-16 w-full shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="text-foreground truncate">
          {activeConversationTitle}
        </div>
      </header>

      <Chat.Messages />
      <Chat.Composer />
    </main>
  )
}
