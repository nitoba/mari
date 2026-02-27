import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'

const REPORTS_DIRECTORY = path.join(process.cwd(), '.output', 'reports')

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const INLINE_EXTENSIONS = new Set<string>([
  '.html',
  '.jpg',
  '.jpeg',
  '.pdf',
  '.png',
  '.svg',
  '.txt',
])

const normalizeAssetName = (rawName: string | null): string | null => {
  if (!rawName) return null

  const trimmedName = rawName.trim()
  if (!trimmedName) return null

  const fileName = path.basename(trimmedName)
  if (fileName !== trimmedName) return null

  const resolvedPath = path.resolve(REPORTS_DIRECTORY, fileName)
  if (!resolvedPath.startsWith(`${REPORTS_DIRECTORY}${path.sep}`)) return null

  return fileName
}

const getContentType = (assetName: string): string => {
  const extension = path.extname(assetName).toLowerCase()
  return MIME_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

const shouldInlineAsset = (assetName: string): boolean =>
  INLINE_EXTENSIONS.has(path.extname(assetName).toLowerCase())

const buildAssetResponse = async (
  request: Request,
  assetName: string,
): Promise<Response> => {
  const assetPath = path.join(REPORTS_DIRECTORY, assetName)

  let assetStat
  try {
    assetStat = await stat(assetPath)
  } catch {
    return Response.json(
      {
        error: `Asset not found: ${assetName}`,
      },
      { status: 404 },
    )
  }

  if (!assetStat.isFile()) {
    return Response.json(
      {
        error: `Asset is not a file: ${assetName}`,
      },
      { status: 404 },
    )
  }

  const fileContent = await readFile(assetPath)
  const requestUrl = new URL(request.url)
  const forceDownload = requestUrl.searchParams.get('download') === '1'

  const inline = !forceDownload && shouldInlineAsset(assetName)
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-length': String(assetStat.size),
    'content-type': getContentType(assetName),
    'x-content-type-options': 'nosniff',
  })

  headers.set(
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${assetName}"`,
  )

  return new Response(fileContent, {
    status: 200,
    headers,
  })
}

const buildAssetsListResponse = async (request: Request): Promise<Response> => {
  let entries
  try {
    entries = await readdir(REPORTS_DIRECTORY, { withFileTypes: true })
  } catch {
    return Response.json({
      assets: [],
      reportsDirectory: REPORTS_DIRECTORY,
    })
  }

  const assetRows = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const normalizedName = normalizeAssetName(entry.name)
        if (!normalizedName) return null

        const filePath = path.join(REPORTS_DIRECTORY, normalizedName)
        const fileStat = await stat(filePath)
        const contentType = getContentType(normalizedName)
        const inline = shouldInlineAsset(normalizedName)
        const encodedName = encodeURIComponent(normalizedName)

        return {
          name: normalizedName,
          size: fileStat.size,
          updatedAt: fileStat.mtime.toISOString(),
          contentType,
          inline,
          viewUrl: `/api/assets?name=${encodedName}`,
          downloadUrl: `/api/assets?name=${encodedName}&download=1`,
        }
      }),
  )

  const assets = assetRows
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))

  return Response.json({
    assets,
    reportsDirectory: REPORTS_DIRECTORY,
    listUrl: new URL('/api/assets', request.url).pathname,
  })
}

export const Route = createFileRoute('/api/assets')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url)
        const assetName = normalizeAssetName(
          requestUrl.searchParams.get('name'),
        )

        if (!requestUrl.searchParams.has('name')) {
          return buildAssetsListResponse(request)
        }

        if (!assetName) {
          return Response.json(
            {
              error: 'Invalid asset name.',
            },
            { status: 400 },
          )
        }

        return buildAssetResponse(request, assetName)
      },
    },
  },
})
