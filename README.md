# Mari

Chat app using `@mariozechner/pi-coding-agent` as backend orchestration and Vercel AI SDK UI streams on the frontend.

## Configuracao de providers (Pi SDK)

Os providers por API key habilitados hoje estao em `src/lib/pi-agent/runtime.ts`:

- `groq` -> `GROQ_API_KEY`
- `zai` -> `ZAI_API_KEY`
- `openrouter` -> `OPENROUTER_API_KEY`

Exemplo:

```bash
export GROQ_API_KEY="..."
export ZAI_API_KEY="..."
export OPENROUTER_API_KEY="..."
```

Opcionalmente, voce pode definir o modelo padrao:

```bash
export PI_DEFAULT_PROVIDER="openrouter"
export PI_DEFAULT_MODEL="openai/gpt-5"
```

Se nenhum default for definido, o backend tenta `groq`, `zai`, `openrouter` (nessa ordem) e, se necessario, cai para o primeiro modelo disponivel no registry.

## Selecao de modelo por request

`POST /api/chat` aceita opcionalmente no body:

```json
{
  "conversationId": "my-conversation",
  "messages": [],
  "model": {
    "provider": "groq",
    "modelId": "openai/gpt-oss-120b",
    "thinkingLevel": "medium"
  }
}
```

Campos suportados em `thinkingLevel`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

## Integracao MCP (recomendada)

O backend agora registra uma tool gateway chamada `mcp` no Pi Agent (arquivo `src/lib/pi-agent/mcp/tool.ts`).

- O Pi continua como cerebro de orquestracao (sessao, reasoning, tool loop).
- O frontend continua igual, consumindo stream da Vercel AI SDK.
- A integracao MCP usa o SDK oficial `@modelcontextprotocol/sdk` em `src/lib/pi-agent/mcp/manager.ts`.

### Onde configurar servidores MCP

A ordem de busca do arquivo de config e:

1. `PI_MCP_CONFIG` (se definido)
2. `.pi/mcp.json` (no projeto)
3. `~/.pi/agent/mcp.json`

Use `docs/mcp.example.json` como base e copie para `.pi/mcp.json`.

### Formato de config

Cada servidor suporta `stdio` (campo `command`) e HTTP (`url`) com lifecycle:

- `lazy` (padrao): conecta so quando necessario
- `eager`: conecta no primeiro uso e mantem conforme timeout
- `keep-alive`: evita desconexao por idle

Timeout global: `settings.idleTimeoutMinutes`.

### Como usar no chat

Voce pode instruir o agente a usar a tool `mcp` nos modos:

- `mcp({})` -> status
- `mcp({ server: "name" })` -> listar tools
- `mcp({ search: "query" })` -> buscar tools
- `mcp({ describe: "tool_name" })` -> ver schema
- `mcp({ connect: "server_name" })` -> conectar servidor
- `mcp({ tool: "tool_name", args: '{"key":"value"}' })` -> executar tool

### Variaveis de ambiente MCP

- `PI_ENABLE_MCP_TOOL` (default: ligado)
- `PI_MCP_CONFIG` (path custom do mcp.json)
- `PI_MCP_IDLE_TIMEOUT_MINUTES` (fallback de timeout global)

Exemplo de token para `docs/mcp.example.json`:

```bash
export CONTEXT7_API_KEY="..."
```

## Subscriptions (futuro)

A integracao usa `AuthStorage.create()` (arquivo de credenciais padrao do Pi), entao continua compativel com OAuth/subscriptions no futuro sem mudar arquitetura.
