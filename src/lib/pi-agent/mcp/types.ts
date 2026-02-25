import type { ImageContent, TextContent } from '@mariozechner/pi-ai'

export type McpServerLifecycle = 'lazy' | 'eager' | 'keep-alive'

export type McpHttpTransport = 'streamable-http' | 'sse'

export type McpServerConfig = {
  command?: string
  args: Array<string>
  env: Record<string, string>
  cwd?: string
  url?: string
  headers: Record<string, string>
  transport?: McpHttpTransport
  auth?: 'bearer'
  bearerToken?: string
  bearerTokenEnv?: string
  lifecycle: McpServerLifecycle
  idleTimeoutMinutes?: number
  exposeResources: boolean
  debug: boolean
}

export type McpSettings = {
  idleTimeoutMinutes: number
}

export type McpConfig = {
  settings: McpSettings
  mcpServers: Record<string, McpServerConfig>
}

export type LoadedMcpConfig = {
  config: McpConfig
  configPath?: string
  error?: string
}

export type McpToolDescriptor = {
  serverName: string
  name: string
  originalName: string
  description: string
  kind: 'tool' | 'resource'
  inputSchema?: unknown
  resourceUri?: string
}

export type McpToolContent = TextContent | ImageContent

export type McpToolExecutionResult = {
  content: Array<McpToolContent>
  details: Record<string, unknown>
}
