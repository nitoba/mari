'use client'

import { Message } from '../prompt-kit/message'
import { TextShimmer } from '../prompt-kit/text-shimmer'
import {
  ErrorMessage,
  LoadingMessage,
  MessageComponent,
} from './custom-message'
import { PromptInput } from './prompt-input'
import { useChatContext } from './provider'
import {
  ChatContainerContent,
  ChatContainerRoot,
} from '@/components/prompt-kit/chat-container'
import { ScrollButton } from '@/components/prompt-kit/scroll-button'

function ChatMessages() {
  const { messages, status, error } = useChatContext()

  return (
    <div className="relative flex-1 overflow-y-auto">
      <ChatContainerRoot className="h-full">
        <ChatContainerContent className="space-y-0 px-5 py-12">
          {messages.map((message, index) => {
            const isLastMessage = index === messages.length - 1

            return (
              <MessageComponent
                key={message.id}
                message={message}
                isLastMessage={isLastMessage}
              />
            )
          })}

          {(status === 'submitted' || status === 'streaming') && (
            <LoadingMessage />
          )}
          {status === 'error' && error && <ErrorMessage error={error} />}
        </ChatContainerContent>
        <div className="absolute bottom-4 left-1/2 flex w-full max-w-4xl -translate-x-1/2 justify-end px-5">
          <ScrollButton className="shadow-sm" />
        </div>
      </ChatContainerRoot>
    </div>
  )
}

function ChatComposer() {
  return (
    <div className="bg-background z-10 shrink-0 px-3 pb-3 md:px-5 md:pb-5">
      <div className="mx-auto max-w-4xl">
        <PromptInput />
      </div>
    </div>
  )
}

export const Chat = {
  Messages: ChatMessages,
  Composer: ChatComposer,
} as const
