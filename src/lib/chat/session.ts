import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { PiModelSelection } from '@/lib/pi-agent/runtime'
import { createStatelessAgentSession } from '@/lib/pi-agent/runtime'
import { loadContextForAgent } from './context'

export type SetupSessionResult = {
  session: AgentSession
}

export const setupAgentSession = async (
  modelSelection: PiModelSelection | undefined,
  userId: string,
  sessionId: string,
): Promise<SetupSessionResult> => {
  const session = await createStatelessAgentSession(modelSelection)
  const contextMessages = await loadContextForAgent({
    userId,
    sessionId,
    tailLimit: 80,
  })
  session.agent.replaceMessages(contextMessages.messages)

  return { session }
}
