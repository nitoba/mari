import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import JSON5 from 'json5'
import type {
  LoadedMcpConfig,
  McpConfig,
  McpHttpTransport,
  McpServerConfig,
  McpServerLifecycle,
} from '@/lib/pi-agent/mcp/types'

const DEFAULT_IDLE_TIMEOUT_MINUTES = 10

const getProjectConfigPath = (): string =>
  path.join(process.cwd(), '.pi', 'mcp.json')

const getGlobalConfigPath = (): string =>
  path.join(homedir(), '.pi', 'agent', 'mcp.json')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined

  const trimmedValue = value.trim()
  return trimmedValue || undefined
}

const normalizeStringArray = (value: unknown): Array<string> => {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => item !== undefined)
}

const normalizeStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {}

  const normalizedRecord: Record<string, string> = {}

  for (const [key, recordValue] of Object.entries(value)) {
    const normalizedKey = normalizeString(key)
    const normalizedValue = normalizeString(recordValue)

    if (!normalizedKey || normalizedValue === undefined) continue
    normalizedRecord[normalizedKey] = normalizedValue
  }

  return normalizedRecord
}

const normalizeNonNegativeNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number') return undefined
  if (!Number.isFinite(value) || value < 0) return undefined
  return value
}

const normalizeLifecycle = (value: unknown): McpServerLifecycle => {
  if (value === 'lazy' || value === 'eager' || value === 'keep-alive') {
    return value
  }

  return 'lazy'
}

const normalizeHttpTransport = (
  value: unknown,
): McpHttpTransport | undefined => {
  if (value === 'streamable-http' || value === 'sse') {
    return value
  }

  return undefined
}

const getConfigSearchPaths = (): Array<string> => {
  const explicitConfigPath = normalizeString(process.env.PI_MCP_CONFIG)

  if (explicitConfigPath) {
    return [path.resolve(explicitConfigPath)]
  }

  return [getProjectConfigPath(), getGlobalConfigPath()]
}

const getFallbackConfig = (): McpConfig => {
  const idleTimeoutFromEnv = normalizeString(
    process.env.PI_MCP_IDLE_TIMEOUT_MINUTES,
  )
  const parsedIdleTimeout =
    idleTimeoutFromEnv === undefined ? undefined : Number(idleTimeoutFromEnv)

  return {
    settings: {
      idleTimeoutMinutes:
        parsedIdleTimeout !== undefined &&
        Number.isFinite(parsedIdleTimeout) &&
        parsedIdleTimeout >= 0
          ? parsedIdleTimeout
          : DEFAULT_IDLE_TIMEOUT_MINUTES,
    },
    mcpServers: {},
  }
}

const normalizeServerConfig = (value: unknown): McpServerConfig | undefined => {
  if (!isRecord(value)) return undefined

  const command = normalizeString(value.command)
  const url = normalizeString(value.url)

  if (!command && !url) {
    return undefined
  }

  const auth = normalizeString(value.auth)

  return {
    command,
    args: normalizeStringArray(value.args),
    env: normalizeStringRecord(value.env),
    cwd: normalizeString(value.cwd),
    url,
    headers: normalizeStringRecord(value.headers),
    transport: normalizeHttpTransport(value.transport),
    auth: auth === 'bearer' ? 'bearer' : undefined,
    bearerToken: normalizeString(value.bearerToken),
    bearerTokenEnv: normalizeString(value.bearerTokenEnv),
    lifecycle: normalizeLifecycle(value.lifecycle),
    idleTimeoutMinutes: normalizeNonNegativeNumber(value.idleTimeoutMinutes),
    exposeResources: value.exposeResources === true,
    debug: value.debug === true,
  }
}

const normalizeConfig = (rawConfig: unknown): McpConfig => {
  const fallbackConfig = getFallbackConfig()

  if (!isRecord(rawConfig)) {
    return fallbackConfig
  }

  const settings = isRecord(rawConfig.settings) ? rawConfig.settings : {}
  const configuredIdleTimeout = normalizeNonNegativeNumber(
    settings.idleTimeoutMinutes,
  )

  const mcpServersRaw = isRecord(rawConfig.mcpServers)
    ? rawConfig.mcpServers
    : {}
  const normalizedServers: Record<string, McpServerConfig> = {}

  for (const [serverName, serverConfig] of Object.entries(mcpServersRaw)) {
    const normalizedServerName = normalizeString(serverName)
    if (!normalizedServerName) continue

    const normalizedServerConfig = normalizeServerConfig(serverConfig)
    if (!normalizedServerConfig) continue

    normalizedServers[normalizedServerName] = normalizedServerConfig
  }

  return {
    settings: {
      idleTimeoutMinutes:
        configuredIdleTimeout ?? fallbackConfig.settings.idleTimeoutMinutes,
    },
    mcpServers: normalizedServers,
  }
}

export const getDefaultMcpConfigPaths = (): Array<string> => [
  getProjectConfigPath(),
  getGlobalConfigPath(),
]

export const loadMcpConfig = (): LoadedMcpConfig => {
  const fallbackConfig = getFallbackConfig()

  for (const configPath of getConfigSearchPaths()) {
    if (!existsSync(configPath)) continue

    try {
      const configContents = readFileSync(configPath, 'utf-8')
      const parsedConfig = JSON5.parse(configContents)

      return {
        config: normalizeConfig(parsedConfig),
        configPath,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Invalid MCP config file.'

      return {
        config: fallbackConfig,
        configPath,
        error: `Failed to parse MCP config at ${configPath}: ${errorMessage}`,
      }
    }
  }

  return {
    config: fallbackConfig,
  }
}
