import JSON5 from 'json5'
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { getPiMcpManager } from '@/lib/pi-agent/mcp/manager'

const MCP_TOOL_PARAMETERS = Type.Object({
  tool: Type.Optional(
    Type.String({
      description: 'Tool name to execute (e.g. "context7_get_docs")',
    }),
  ),
  args: Type.Optional(
    Type.String({
      description: 'Arguments as JSON string (e.g. {"query":"tanstack"})',
    }),
  ),
  server: Type.Optional(
    Type.String({
      description: 'Optional server name for list/search/describe/call',
    }),
  ),
  search: Type.Optional(
    Type.String({
      description: 'Search query for tools',
    }),
  ),
  describe: Type.Optional(
    Type.String({
      description: 'Tool name to describe',
    }),
  ),
  connect: Type.Optional(
    Type.String({
      description: 'Server name to connect lazily',
    }),
  ),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type McpToolParameters = {
  tool?: string
  args?: string
  server?: string
  search?: string
  describe?: string
  connect?: string
}

const normalizeParams = (value: unknown): McpToolParameters => {
  if (!isRecord(value)) return {}

  return {
    tool: typeof value.tool === 'string' ? value.tool : undefined,
    args: typeof value.args === 'string' ? value.args : undefined,
    server: typeof value.server === 'string' ? value.server : undefined,
    search: typeof value.search === 'string' ? value.search : undefined,
    describe: typeof value.describe === 'string' ? value.describe : undefined,
    connect: typeof value.connect === 'string' ? value.connect : undefined,
  }
}

const parseJsonArgs = (args?: string): Record<string, unknown> => {
  if (!args?.trim()) return {}

  let parsedArgs: unknown

  try {
    parsedArgs = JSON5.parse(args)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Invalid JSON arguments.'
    throw new Error(`Invalid MCP args JSON: ${errorMessage}`)
  }

  if (!isRecord(parsedArgs)) {
    throw new Error('MCP args must be a JSON object.')
  }

  return parsedArgs
}

export const createMcpGatewayTool = (): ToolDefinition => {
  const manager = getPiMcpManager()

  return {
    name: 'mcp',
    label: 'MCP',
    description:
      'MCP gateway tool for server status, tool discovery, and tool execution.',
    parameters: MCP_TOOL_PARAMETERS,
    async execute(_toolCallId, params, signal) {
      const normalizedParams = normalizeParams(params)

      if (normalizedParams.tool) {
        const parsedArgs = parseJsonArgs(normalizedParams.args)

        return await manager.callTool(normalizedParams.tool, parsedArgs, {
          serverName: normalizedParams.server,
          signal,
        })
      }

      if (normalizedParams.connect) {
        return await manager.connect(normalizedParams.connect)
      }

      if (normalizedParams.describe) {
        return await manager.describeTool(
          normalizedParams.describe,
          normalizedParams.server,
        )
      }

      if (normalizedParams.search) {
        return await manager.searchTools(
          normalizedParams.search,
          normalizedParams.server,
        )
      }

      if (normalizedParams.server) {
        return await manager.listServerTools(normalizedParams.server)
      }

      return await manager.getStatus()
    },
  }
}
