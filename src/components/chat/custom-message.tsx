import { memo } from 'react'
import { AlertTriangle, Copy, ThumbsDown, ThumbsUp } from 'lucide-react'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from '../prompt-kit/message'
import { TypingLoader } from '../prompt-kit/loader'
import { Button } from '../ui/button'
import { Tool } from '../prompt-kit/tool'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '../prompt-kit/reasoning'
import { TextShimmer } from '../prompt-kit/text-shimmer'
import type { ToolPart } from '../prompt-kit/tool'
import type { UIMessage } from 'ai'
import { cn } from '@/lib/utils'

type MessageComponentProps = {
  message: UIMessage
  isLastMessage: boolean
}

type MessagePart = UIMessage['parts'][number]
type TextMessagePart = Extract<MessagePart, { type: 'text' }>
type ReasoningMessagePart = Extract<MessagePart, { type: 'reasoning' }>
type ToolMessagePart = Extract<MessagePart, { type: `tool-${string}` }>

const isToolMessagePart = (part: MessagePart): part is ToolMessagePart =>
  part.type.startsWith('tool-')

const isTextMessagePart = (part: MessagePart): part is TextMessagePart =>
  part.type === 'text'

const isReasoningMessagePart = (
  part: MessagePart,
): part is ReasoningMessagePart => part.type === 'reasoning'

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(isTextMessagePart)
    .map((part) => part.text)
    .join('')

const getMessageReasoning = (message: UIMessage): string =>
  message.parts
    .filter(isReasoningMessagePart)
    .map((part) => part.text)
    .join('\n')

type AssistantMessageProps = {
  message: UIMessage
  isLastMessage: boolean
}

const AssistantMessage = memo(
  ({ message, isLastMessage }: AssistantMessageProps) => {
    const toolParts = message.parts.filter(isToolMessagePart)
    const content = getMessageText(message)
    const reasoning = getMessageReasoning(message)

    return (
      <Message
        className={cn(
          'mx-auto flex w-full max-w-4xl flex-col gap-2 px-2 md:px-10',
          'items-start',
        )}
      >
        {reasoning && (
          <Reasoning isStreaming>
            <ReasoningTrigger>Show reasoning</ReasoningTrigger>
            <ReasoningContent className="ml-2 border-l-2 border-l-slate-200 px-2 pb-1 dark:border-l-slate-700">
              {reasoning}
            </ReasoningContent>
          </Reasoning>
        )}

        <div className="group flex w-full flex-col gap-0 space-y-2">
          <div className="w-full">
            {toolParts.map((part, index) => (
              <Tool key={`${part.type}-${index}`} toolPart={part as ToolPart} />
            ))}
          </div>

          <MessageContent
            className="text-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0"
            markdown
          >
            {content}
          </MessageContent>

          <MessageActions
            className={cn(
              '-ml-2.5 flex gap-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100',
              isLastMessage && 'opacity-100',
            )}
          >
            <MessageAction tooltip="Copy">
              <Button variant="ghost" size="icon" className="rounded-full">
                <Copy />
              </Button>
            </MessageAction>
            <MessageAction tooltip="Upvote">
              <Button variant="ghost" size="icon" className="rounded-full">
                <ThumbsUp />
              </Button>
            </MessageAction>
            <MessageAction tooltip="Downvote">
              <Button variant="ghost" size="icon" className="rounded-full">
                <ThumbsDown />
              </Button>
            </MessageAction>
          </MessageActions>
        </div>
      </Message>
    )
  },
)

AssistantMessage.displayName = 'AssistantMessage'

type UserMessageProps = {
  message: UIMessage
}

const UserMessage = memo(({ message }: UserMessageProps) => {
  const content = getMessageText(message)

  return (
    <Message
      className={cn(
        'mx-auto flex w-full max-w-4xl flex-col gap-2 px-2 md:px-10',
        'items-end',
      )}
    >
      <div className="group flex w-full flex-col items-end gap-1">
        <MessageContent className="bg-muted text-primary max-w-[85%] rounded-3xl px-5 py-2.5 whitespace-pre-wrap sm:max-w-[75%]">
          {content}
        </MessageContent>
        <MessageActions className="flex gap-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <MessageAction tooltip="Copy">
            <Button variant="ghost" size="icon" className="rounded-full">
              <Copy />
            </Button>
          </MessageAction>
        </MessageActions>
      </div>
    </Message>
  )
})

UserMessage.displayName = 'UserMessage'

export const MessageComponent = memo(
  ({ message, isLastMessage }: MessageComponentProps) => {
    return message.role === 'assistant' ? (
      <AssistantMessage message={message} isLastMessage={isLastMessage} />
    ) : (
      <UserMessage message={message} />
    )
  },
)

MessageComponent.displayName = 'MessageComponent'

export const LoadingMessage = memo(() => (
  <Message className="mx-auto flex w-full max-w-4xl flex-col items-start gap-2 px-0 md:px-10">
    <div className="group flex w-full flex-col gap-0">
      <div className="text-foreground prose w-full min-w-0 flex-1 rounded-lg bg-transparent p-0">
        <TextShimmer className="font-mono text-sm">Thinking...</TextShimmer>
      </div>
    </div>
  </Message>
))

LoadingMessage.displayName = 'LoadingMessage'

export const ErrorMessage = memo(({ error }: { error: Error }) => (
  <Message className="not-prose mx-auto flex w-full max-w-4xl flex-col items-start gap-2 px-0 md:px-10">
    <div className="group flex w-full flex-col items-start gap-0">
      <div className="text-primary flex min-w-0 flex-1 flex-row items-center gap-2 rounded-lg border-2 border-red-300 bg-red-300/20 px-2 py-1">
        <AlertTriangle size={16} className="text-red-500" />
        <p className="text-red-500">{error.message}</p>
      </div>
    </div>
  </Message>
))

ErrorMessage.displayName = 'ErrorMessage'
