import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { TextContent } from '@mariozechner/pi-ai'
import type {
  LoadedMcpConfig,
  McpServerConfig,
  McpToolContent,
  McpToolDescriptor,
  McpToolExecutionResult,
} from '@/lib/pi-agent/mcp/types'
import {
  getDefaultMcpConfigPaths,
  loadMcpConfig,
} from '@/lib/pi-agent/mcp/config'

const CONNECTION_IDLE_CHECK_INTERVAL_MS = 30_000

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport

type McpConnection = {
  client: Client
  transport: McpTransport
  metadata: Array<McpToolDescriptor>
  inFlightRequests: number
  lastUsedAt: number
  serverFingerprint: string
}

type ResolvedTool = {
  descriptor: McpToolDescriptor
  connection: McpConnection
}

type RuntimeGlobals = typeof globalThis & {
  __mariPiMcpManager?: PiMcpManager
}

const runtimeGlobals = globalThis as RuntimeGlobals

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeComparisonName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const normalizeServerPrefix = (serverName: string): string => {
  const normalizedServerName = normalizeComparisonName(serverName)
  return normalizedServerName || 'mcp'
}

const resourceNameToToolName = (value: string): string => {
  const normalizedResourceName = normalizeComparisonName(value)
  return normalizedResourceName || 'resource'
}

const formatToolName = (serverName: string, originalToolName: string): string =>
  `${normalizeServerPrefix(serverName)}_${normalizeComparisonName(originalToolName)}`

const getServerFingerprint = (serverDefinition: McpServerConfig): string =>
  JSON.stringify({
    command: serverDefinition.command,
    args: serverDefinition.args,
    env: serverDefinition.env,
    cwd: serverDefinition.cwd,
    url: serverDefinition.url,
    headers: serverDefinition.headers,
    transport: serverDefinition.transport,
    auth: serverDefinition.auth,
    bearerToken: serverDefinition.bearerToken,
    bearerTokenEnv: serverDefinition.bearerTokenEnv,
    exposeResources: serverDefinition.exposeResources,
  })

const interpolateEnvironmentVariables = (value: string): string =>
  value
    .replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, variableName: string) => {
      const environmentValue = process.env[variableName]
      return environmentValue ?? ''
    })
    .replace(/\$env:([A-Z0-9_]+)/gi, (_match, variableName: string) => {
      const environmentValue = process.env[variableName]
      return environmentValue ?? ''
    })

const interpolateStringRecord = (
  values: Record<string, string>,
): Record<string, string> => {
  const resolvedValues: Record<string, string> = {}

  for (const [key, value] of Object.entries(values)) {
    resolvedValues[key] = interpolateEnvironmentVariables(value)
  }

  return resolvedValues
}

const getProcessEnvironment = (): Record<string, string> => {
  const processEnvironment: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue
    processEnvironment[key] = value
  }

  return processEnvironment
}

const getHttpRequestInit = (
  serverDefinition: McpServerConfig,
): RequestInit | undefined => {
  const headers = interpolateStringRecord(serverDefinition.headers)

  if (serverDefinition.auth === 'bearer') {
    const bearerToken =
      serverDefinition.bearerToken ??
      (serverDefinition.bearerTokenEnv
        ? process.env[serverDefinition.bearerTokenEnv]
        : undefined)

    if (bearerToken) {
      headers.Authorization = `Bearer ${interpolateEnvironmentVariables(bearerToken)}`
    }
  }

  if (Object.keys(headers).length === 0) {
    return undefined
  }

  return { headers }
}

const toTextContent = (text: string): TextContent => ({
  type: 'text',
  text,
})

const formatSchema = (schema: unknown, indent = '  '): string => {
  if (!isRecord(schema)) {
    return `${indent}(no schema)`
  }

  if (schema.type !== 'object' || !isRecord(schema.properties)) {
    return `${indent}(non-object schema)`
  }

  const requiredProperties = Array.isArray(schema.required)
    ? schema.required.filter(
        (propertyName): propertyName is string =>
          typeof propertyName === 'string',
      )
    : []

  const properties = Object.entries(schema.properties)

  if (properties.length === 0) {
    return `${indent}(no parameters)`
  }

  return properties
    .map(([propertyName, propertySchema]) => {
      if (!isRecord(propertySchema)) {
        return `${indent}${propertyName}`
      }

      const pieces: Array<string> = []
      pieces.push(`${indent}${propertyName}`)

      if (typeof propertySchema.type === 'string') {
        pieces.push(`(${propertySchema.type})`)
      }

      if (
        Array.isArray(propertySchema.enum) &&
        propertySchema.enum.length > 0
      ) {
        const enumValues = propertySchema.enum
          .map((enumValue) => JSON.stringify(enumValue))
          .join(', ')
        pieces.push(`enum: ${enumValues}`)
      }

      if (requiredProperties.includes(propertyName)) {
        pieces.push('[required]')
      }

      if (typeof propertySchema.description === 'string') {
        pieces.push(`- ${propertySchema.description}`)
      }

      if (propertySchema.default !== undefined) {
        pieces.push(`[default: ${JSON.stringify(propertySchema.default)}]`)
      }

      return pieces.join(' ')
    })
    .join('\n')
}

const safeJsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const extractTextFromContentBlocks = (
  blocks: Array<McpToolContent>,
): string | undefined => {
  const text = blocks
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  return text || undefined
}

const normalizeToolArgs = (
  args: Record<string, unknown>,
): Record<string, unknown> => args

export class PiMcpManager {
  private configState: LoadedMcpConfig = loadMcpConfig()

  private readonly connections = new Map<string, McpConnection>()

  private readonly connectionPromises = new Map<
    string,
    Promise<McpConnection>
  >()

  private readonly idleCleanupTimer: ReturnType<typeof setInterval>

  constructor() {
    this.idleCleanupTimer = setInterval(() => {
      void this.closeIdleConnections()
    }, CONNECTION_IDLE_CHECK_INTERVAL_MS)
    this.idleCleanupTimer.unref()
  }

  private async reloadConfig(): Promise<void> {
    this.configState = loadMcpConfig()

    const configuredServerNames = new Set(
      Object.keys(this.configState.config.mcpServers),
    )

    const serversToClose: Array<string> = []

    for (const connectedServerName of this.connections.keys()) {
      if (configuredServerNames.has(connectedServerName)) continue
      serversToClose.push(connectedServerName)
    }

    await Promise.all(
      serversToClose.map(async (serverName) => {
        await this.closeConnection(serverName)
      }),
    )
  }

  private getServerDefinition(serverName: string): McpServerConfig {
    if (!(serverName in this.configState.config.mcpServers)) {
      throw new Error(`MCP server "${serverName}" is not configured.`)
    }

    return this.configState.config.mcpServers[serverName]
  }

  private createTransport(
    serverName: string,
    serverDefinition: McpServerConfig,
  ): McpTransport {
    if (serverDefinition.command) {
      const serverEnvironment = {
        ...getProcessEnvironment(),
        ...interpolateStringRecord(serverDefinition.env),
      }

      return new StdioClientTransport({
        command: serverDefinition.command,
        args: serverDefinition.args,
        env: serverEnvironment,
        cwd: serverDefinition.cwd,
        stderr: serverDefinition.debug ? 'inherit' : 'ignore',
      })
    }

    if (!serverDefinition.url) {
      throw new Error(`MCP server "${serverName}" has no command or url.`)
    }

    const url = new URL(serverDefinition.url)
    const requestInit = getHttpRequestInit(serverDefinition)

    if (serverDefinition.transport === 'sse') {
      return new StreamableHTTPClientTransport(url, { requestInit })
    }

    return new StreamableHTTPClientTransport(url, { requestInit })
  }

  private async loadServerMetadata(
    client: Client,
    serverName: string,
    serverDefinition: McpServerConfig,
  ): Promise<Array<McpToolDescriptor>> {
    const metadata: Array<McpToolDescriptor> = []

    let toolsCursor: string | undefined

    do {
      const toolsResult = await client.listTools(
        toolsCursor ? { cursor: toolsCursor } : undefined,
      )

      for (const tool of toolsResult.tools) {
        metadata.push({
          serverName,
          name: formatToolName(serverName, tool.name),
          originalName: tool.name,
          description: tool.description || '',
          kind: 'tool',
          inputSchema: tool.inputSchema,
        })
      }

      toolsCursor = toolsResult.nextCursor
    } while (toolsCursor)

    if (!serverDefinition.exposeResources) {
      return metadata
    }

    try {
      let resourcesCursor: string | undefined

      do {
        const resourcesResult = await client.listResources(
          resourcesCursor ? { cursor: resourcesCursor } : undefined,
        )

        for (const resource of resourcesResult.resources) {
          const resourceToolName = `get_${resourceNameToToolName(resource.name)}`

          metadata.push({
            serverName,
            name: formatToolName(serverName, resourceToolName),
            originalName: resourceToolName,
            description:
              resource.description || `Read resource: ${resource.uri}`,
            kind: 'resource',
            resourceUri: resource.uri,
          })
        }

        resourcesCursor = resourcesResult.nextCursor
      } while (resourcesCursor)
    } catch {
      return metadata
    }

    return metadata
  }

  private async connectWithTransport(
    serverName: string,
    serverDefinition: McpServerConfig,
    serverFingerprint: string,
    transport: McpTransport,
  ): Promise<McpConnection> {
    const client = new Client({
      name: `mari-mcp-${normalizeServerPrefix(serverName)}`,
      version: '1.0.0',
    })

    try {
      await client.connect(transport)
      const metadata = await this.loadServerMetadata(
        client,
        serverName,
        serverDefinition,
      )

      return {
        client,
        transport,
        metadata,
        inFlightRequests: 0,
        lastUsedAt: Date.now(),
        serverFingerprint,
      }
    } catch (error) {
      await client.close().catch(() => undefined)
      await transport.close().catch(() => undefined)
      throw error
    }
  }

  private async createConnection(
    serverName: string,
    serverDefinition: McpServerConfig,
    serverFingerprint: string,
  ): Promise<McpConnection> {
    const primaryTransport = this.createTransport(serverName, serverDefinition)

    try {
      return await this.connectWithTransport(
        serverName,
        serverDefinition,
        serverFingerprint,
        primaryTransport,
      )
    } catch (primaryError) {
      if (serverDefinition.transport || !serverDefinition.url) {
        throw primaryError
      }

      await primaryTransport.close().catch(() => undefined)

      const fallbackTransport = new StreamableHTTPClientTransport(
        new URL(serverDefinition.url),
        {
          requestInit: getHttpRequestInit(serverDefinition),
        },
      )

      return await this.connectWithTransport(
        serverName,
        serverDefinition,
        serverFingerprint,
        fallbackTransport,
      )
    }
  }

  private async ensureServerConnected(
    serverName: string,
  ): Promise<McpConnection> {
    const serverDefinition = this.getServerDefinition(serverName)
    const serverFingerprint = getServerFingerprint(serverDefinition)
    const existingConnection = this.connections.get(serverName)

    if (existingConnection?.serverFingerprint === serverFingerprint) {
      existingConnection.lastUsedAt = Date.now()
      return existingConnection
    }

    if (existingConnection) {
      await this.closeConnection(serverName)
    }

    const pendingConnection = this.connectionPromises.get(serverName)
    if (pendingConnection) {
      return await pendingConnection
    }

    const connectionPromise = this.createConnection(
      serverName,
      serverDefinition,
      serverFingerprint,
    )

    this.connectionPromises.set(serverName, connectionPromise)

    try {
      const connection = await connectionPromise
      this.connections.set(serverName, connection)
      return connection
    } finally {
      this.connectionPromises.delete(serverName)
    }
  }

  private async closeConnection(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName)
    if (!connection) return

    this.connections.delete(serverName)

    await connection.client.close().catch(() => undefined)
    await connection.transport.close().catch(() => undefined)
  }

  private async closeIdleConnections(): Promise<void> {
    await this.reloadConfig()

    const now = Date.now()
    const idleTimeoutMinutes =
      this.configState.config.settings.idleTimeoutMinutes

    if (idleTimeoutMinutes <= 0) {
      return
    }

    const connectionsToClose: Array<string> = []

    for (const [serverName, connection] of this.connections.entries()) {
      if (!(serverName in this.configState.config.mcpServers)) {
        connectionsToClose.push(serverName)
        continue
      }

      const serverDefinition = this.configState.config.mcpServers[serverName]

      if (serverDefinition.lifecycle === 'keep-alive') continue
      if (connection.inFlightRequests > 0) continue

      const effectiveTimeoutMinutes =
        serverDefinition.idleTimeoutMinutes ?? idleTimeoutMinutes

      if (effectiveTimeoutMinutes <= 0) continue

      const connectionIdleForMs = now - connection.lastUsedAt
      if (connectionIdleForMs < effectiveTimeoutMinutes * 60_000) continue

      connectionsToClose.push(serverName)
    }

    await Promise.all(
      connectionsToClose.map(async (serverName) => {
        await this.closeConnection(serverName)
      }),
    )
  }

  private async ensureMetadataAcrossServers(): Promise<void> {
    const allServerNames = Object.keys(this.configState.config.mcpServers)

    await Promise.all(
      allServerNames.map(async (serverName) => {
        try {
          await this.ensureServerConnected(serverName)
        } catch {
          return
        }
      }),
    )
  }

  private getConnectedMetadata(serverName?: string): Array<McpToolDescriptor> {
    if (serverName) {
      return this.connections.get(serverName)?.metadata ?? []
    }

    return Array.from(this.connections.values()).flatMap(
      (connection) => connection.metadata,
    )
  }

  private isToolMatch(
    descriptor: McpToolDescriptor,
    toolName: string,
  ): boolean {
    const normalizedRequestedName = normalizeComparisonName(toolName)
    if (!normalizedRequestedName) return false

    return (
      normalizeComparisonName(descriptor.name) === normalizedRequestedName ||
      normalizeComparisonName(descriptor.originalName) ===
        normalizedRequestedName
    )
  }

  private async resolveTool(
    toolName: string,
    serverName?: string,
  ): Promise<ResolvedTool> {
    const normalizedServerName = serverName?.trim()

    if (normalizedServerName) {
      const connection = await this.ensureServerConnected(normalizedServerName)
      const descriptor = connection.metadata.find((metadataEntry) =>
        this.isToolMatch(metadataEntry, toolName),
      )

      if (!descriptor) {
        throw new Error(
          `Tool "${toolName}" was not found on MCP server "${normalizedServerName}".`,
        )
      }

      return {
        descriptor,
        connection,
      }
    }

    let allDescriptors = this.getConnectedMetadata()

    if (allDescriptors.length === 0) {
      await this.ensureMetadataAcrossServers()
      allDescriptors = this.getConnectedMetadata()
    }

    const matches = allDescriptors.filter((descriptor) =>
      this.isToolMatch(descriptor, toolName),
    )

    if (matches.length === 0) {
      throw new Error(
        `Tool "${toolName}" was not found. Use mcp({ search: "..." }) to discover available tools.`,
      )
    }

    if (matches.length > 1) {
      const ambiguousServers = Array.from(
        new Set(matches.map((match) => match.serverName)),
      )

      throw new Error(
        `Tool "${toolName}" is ambiguous across servers: ${ambiguousServers.join(', ')}. Provide the "server" parameter.`,
      )
    }

    const descriptor = matches[0]
    const connection = await this.ensureServerConnected(descriptor.serverName)

    return {
      descriptor,
      connection,
    }
  }

  private transformMcpContent(content: unknown): Array<McpToolContent> {
    if (!Array.isArray(content)) {
      return []
    }

    const transformedContent: Array<McpToolContent> = []

    for (const contentPart of content) {
      if (!isRecord(contentPart) || typeof contentPart.type !== 'string') {
        transformedContent.push(toTextContent(safeJsonStringify(contentPart)))
        continue
      }

      if (contentPart.type === 'text' && typeof contentPart.text === 'string') {
        transformedContent.push({
          type: 'text',
          text: contentPart.text,
        })
        continue
      }

      if (
        contentPart.type === 'image' &&
        typeof contentPart.data === 'string' &&
        typeof contentPart.mimeType === 'string'
      ) {
        transformedContent.push({
          type: 'image',
          data: contentPart.data,
          mimeType: contentPart.mimeType,
        })
        continue
      }

      if (contentPart.type === 'audio') {
        transformedContent.push(
          toTextContent(
            `[Audio content: ${typeof contentPart.mimeType === 'string' ? contentPart.mimeType : 'audio/*'}]`,
          ),
        )
        continue
      }

      if (contentPart.type === 'resource' && isRecord(contentPart.resource)) {
        const resourceUri =
          typeof contentPart.resource.uri === 'string'
            ? contentPart.resource.uri
            : '(unknown-uri)'

        if (typeof contentPart.resource.text === 'string') {
          transformedContent.push(
            toTextContent(
              `[Resource: ${resourceUri}]\n${contentPart.resource.text}`,
            ),
          )
        } else if (typeof contentPart.resource.blob === 'string') {
          const mimeType =
            typeof contentPart.resource.mimeType === 'string'
              ? contentPart.resource.mimeType
              : 'application/octet-stream'

          transformedContent.push(
            toTextContent(
              `[Resource: ${resourceUri}] [Binary content: ${mimeType}]`,
            ),
          )
        } else {
          transformedContent.push(
            toTextContent(
              `[Resource: ${resourceUri}] ${safeJsonStringify(contentPart)}`,
            ),
          )
        }
        continue
      }

      if (contentPart.type === 'resource_link') {
        const linkName =
          typeof contentPart.name === 'string'
            ? contentPart.name
            : 'resource-link'
        const linkUri =
          typeof contentPart.uri === 'string'
            ? contentPart.uri
            : '(unknown-uri)'

        transformedContent.push(
          toTextContent(`[Resource Link: ${linkName}]\nURI: ${linkUri}`),
        )
        continue
      }

      transformedContent.push(toTextContent(safeJsonStringify(contentPart)))
    }

    return transformedContent
  }

  private createTextResult(
    text: string,
    details: Record<string, unknown>,
  ): McpToolExecutionResult {
    return {
      content: [toTextContent(text)],
      details,
    }
  }

  private getToolUsageHelpText(): string {
    return [
      'MCP gateway usage:',
      '  mcp({}) -> status',
      '  mcp({ server: "name" }) -> list tools from server',
      '  mcp({ search: "query" }) -> search tools',
      '  mcp({ describe: "tool_name" }) -> describe tool schema',
      '  mcp({ connect: "server_name" }) -> connect and cache tools',
      `  mcp({ tool: "tool_name", args: '{"key":"value"}' }) -> execute tool`,
    ].join('\n')
  }

  private getConfiguredServerNames(): Array<string> {
    return Object.keys(this.configState.config.mcpServers)
  }

  public async getStatus(): Promise<McpToolExecutionResult> {
    await this.reloadConfig()

    const configuredServerNames = this.getConfiguredServerNames()

    if (configuredServerNames.length === 0) {
      const defaultPaths = getDefaultMcpConfigPaths()
      const pathDescription = defaultPaths
        .map((configPath) => `- ${configPath}`)
        .join('\n')

      const configurationText = this.configState.configPath
        ? `Current MCP config path: ${this.configState.configPath}`
        : 'No MCP config file found.'

      const parseErrorText = this.configState.error
        ? `\n\nConfig error:\n${this.configState.error}`
        : ''

      return this.createTextResult(
        `${configurationText}\n\nCreate one of these files:\n${pathDescription}${parseErrorText}\n\n${this.getToolUsageHelpText()}`,
        {
          mode: 'status',
          configuredServers: 0,
          connectedServers: this.connections.size,
          configPath: this.configState.configPath,
          configError: this.configState.error,
        },
      )
    }

    const statusLines = configuredServerNames.map((serverName) => {
      const connection = this.connections.get(serverName)
      const metadataCount = connection?.metadata.length ?? 0

      if (!connection) {
        const lifecycle =
          this.configState.config.mcpServers[serverName].lifecycle
        return `- ${serverName}: idle (${lifecycle})`
      }

      return `- ${serverName}: connected (${metadataCount} tools)`
    })

    const connectedServers = configuredServerNames.filter((serverName) =>
      this.connections.has(serverName),
    ).length

    return this.createTextResult(
      [
        `MCP status: ${connectedServers}/${configuredServerNames.length} servers connected`,
        '',
        ...statusLines,
        '',
        this.getToolUsageHelpText(),
      ].join('\n'),
      {
        mode: 'status',
        configuredServers: configuredServerNames.length,
        connectedServers,
        configPath: this.configState.configPath,
        configError: this.configState.error,
      },
    )
  }

  public async connect(serverName: string): Promise<McpToolExecutionResult> {
    await this.reloadConfig()

    const normalizedServerName = serverName.trim()
    if (!normalizedServerName) {
      throw new Error('Missing MCP server name.')
    }

    const connection = await this.ensureServerConnected(normalizedServerName)

    return this.createTextResult(
      `Connected to MCP server "${normalizedServerName}" with ${connection.metadata.length} tools.`,
      {
        mode: 'connect',
        server: normalizedServerName,
        toolCount: connection.metadata.length,
      },
    )
  }

  public async listServerTools(
    serverName: string,
  ): Promise<McpToolExecutionResult> {
    await this.reloadConfig()

    const normalizedServerName = serverName.trim()
    if (!normalizedServerName) {
      throw new Error('Missing MCP server name.')
    }

    const connection = await this.ensureServerConnected(normalizedServerName)
    const metadata = connection.metadata

    if (metadata.length === 0) {
      return this.createTextResult(
        `MCP server "${normalizedServerName}" has no tools.`,
        {
          mode: 'list',
          server: normalizedServerName,
          toolCount: 0,
        },
      )
    }

    const toolLines = metadata.map((descriptor) => {
      const summary = descriptor.description
        ? ` - ${descriptor.description}`
        : ''
      return `- ${descriptor.name}${summary}`
    })

    return this.createTextResult(
      [
        `Tools on "${normalizedServerName}" (${metadata.length}):`,
        '',
        ...toolLines,
      ].join('\n'),
      {
        mode: 'list',
        server: normalizedServerName,
        toolCount: metadata.length,
      },
    )
  }

  public async searchTools(
    searchQuery: string,
    serverName?: string,
  ): Promise<McpToolExecutionResult> {
    await this.reloadConfig()

    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      throw new Error('Search query cannot be empty.')
    }

    if (serverName?.trim()) {
      await this.ensureServerConnected(serverName.trim())
    } else {
      await this.ensureMetadataAcrossServers()
    }

    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean)
    const descriptors = this.getConnectedMetadata(serverName?.trim())

    const scoredMatches = descriptors
      .map((descriptor) => {
        const haystackName = descriptor.name.toLowerCase()
        const haystackDescription = descriptor.description.toLowerCase()

        let score = 0
        for (const queryTerm of queryTerms) {
          if (haystackName.includes(queryTerm)) score += 2
          if (haystackDescription.includes(queryTerm)) score += 1
        }

        return {
          descriptor,
          score,
        }
      })
      .filter((match) => match.score > 0)
      .sort((first, second) => {
        if (second.score !== first.score) {
          return second.score - first.score
        }

        return first.descriptor.name.localeCompare(second.descriptor.name)
      })

    if (scoredMatches.length === 0) {
      return this.createTextResult(`No MCP tools matched "${searchQuery}".`, {
        mode: 'search',
        query: searchQuery,
        resultCount: 0,
        server: serverName,
      })
    }

    const resultLines = scoredMatches.slice(0, 50).map((match) => {
      const summary = match.descriptor.description
        ? ` - ${match.descriptor.description}`
        : ''

      return `- ${match.descriptor.name} (server: ${match.descriptor.serverName})${summary}`
    })

    return this.createTextResult(
      [
        `Found ${scoredMatches.length} MCP tools matching "${searchQuery}":`,
        '',
        ...resultLines,
      ].join('\n'),
      {
        mode: 'search',
        query: searchQuery,
        resultCount: scoredMatches.length,
        server: serverName,
      },
    )
  }

  public async describeTool(
    toolName: string,
    serverName?: string,
  ): Promise<McpToolExecutionResult> {
    await this.reloadConfig()

    const resolvedTool = await this.resolveTool(toolName, serverName)
    const { descriptor } = resolvedTool

    const toolDetails = [
      descriptor.name,
      `Server: ${descriptor.serverName}`,
      descriptor.kind === 'resource' ? 'Type: resource' : 'Type: tool',
      '',
      descriptor.description || '(no description)',
    ]

    if (descriptor.kind === 'resource') {
      toolDetails.push(
        '',
        `Resource URI: ${descriptor.resourceUri ?? '(unknown)'}`,
        'This resource tool accepts no arguments.',
      )
    } else {
      toolDetails.push('', 'Parameters:', formatSchema(descriptor.inputSchema))
    }

    return this.createTextResult(toolDetails.join('\n'), {
      mode: 'describe',
      tool: descriptor.name,
      server: descriptor.serverName,
      kind: descriptor.kind,
    })
  }

  public async callTool(
    toolName: string,
    args: Record<string, unknown>,
    options?: {
      serverName?: string
      signal?: AbortSignal
    },
  ): Promise<McpToolExecutionResult> {
    await this.reloadConfig()

    const resolvedTool = await this.resolveTool(toolName, options?.serverName)
    const { descriptor, connection } = resolvedTool

    connection.lastUsedAt = Date.now()
    connection.inFlightRequests += 1

    try {
      if (descriptor.kind === 'resource') {
        const resourceUri = descriptor.resourceUri
        if (!resourceUri) {
          throw new Error(
            `Resource descriptor "${descriptor.name}" has no resource URI.`,
          )
        }

        const resourceResult = await connection.client.readResource(
          { uri: resourceUri },
          {
            signal: options?.signal,
          },
        )

        const content = this.transformMcpContent(
          (resourceResult as { contents?: unknown }).contents,
        )

        return {
          content:
            content.length > 0
              ? content
              : [toTextContent('(empty resource result)')],
          details: {
            mode: 'call',
            server: descriptor.serverName,
            tool: descriptor.name,
            originalTool: descriptor.originalName,
            kind: descriptor.kind,
            resourceUri,
          },
        }
      }

      const callResult = await connection.client.callTool(
        {
          name: descriptor.originalName,
          arguments: normalizeToolArgs(args),
        },
        undefined,
        {
          signal: options?.signal,
        },
      )

      if (isRecord(callResult) && 'toolResult' in callResult) {
        return {
          content: [
            toTextContent(
              safeJsonStringify(
                (callResult as { toolResult: unknown }).toolResult,
              ),
            ),
          ],
          details: {
            mode: 'call',
            server: descriptor.serverName,
            tool: descriptor.name,
            originalTool: descriptor.originalName,
            kind: descriptor.kind,
          },
        }
      }

      const typedResult = callResult as {
        content?: unknown
        structuredContent?: unknown
        isError?: boolean
      }

      const transformedContent = this.transformMcpContent(typedResult.content)
      const finalContent =
        transformedContent.length > 0
          ? transformedContent
          : typedResult.structuredContent !== undefined
            ? [toTextContent(safeJsonStringify(typedResult.structuredContent))]
            : [toTextContent('(empty tool result)')]

      if (typedResult.isError) {
        const errorText =
          extractTextFromContentBlocks(finalContent) ||
          `MCP tool "${descriptor.name}" failed.`

        throw new Error(errorText)
      }

      return {
        content: finalContent,
        details: {
          mode: 'call',
          server: descriptor.serverName,
          tool: descriptor.name,
          originalTool: descriptor.originalName,
          kind: descriptor.kind,
        },
      }
    } finally {
      connection.inFlightRequests -= 1
      connection.lastUsedAt = Date.now()
    }
  }

  public async dispose(): Promise<void> {
    clearInterval(this.idleCleanupTimer)

    await Promise.all(
      Array.from(this.connections.keys()).map(async (serverName) => {
        await this.closeConnection(serverName)
      }),
    )
  }
}

export const getPiMcpManager = (): PiMcpManager => {
  if (!runtimeGlobals.__mariPiMcpManager) {
    runtimeGlobals.__mariPiMcpManager = new PiMcpManager()
  }

  return runtimeGlobals.__mariPiMcpManager
}
