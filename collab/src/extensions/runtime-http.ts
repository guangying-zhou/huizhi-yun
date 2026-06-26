import type { Extension, onRequestPayload } from '@hocuspocus/server'
import type { CollabRuntimeStatus } from '../providers/types.js'

type StatusGetter = () => CollabRuntimeStatus

function normalizePath(pathname: string, basePath: string) {
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  if (normalizedBase && pathname.startsWith(`${normalizedBase}/`)) {
    return pathname.slice(normalizedBase.length) || '/'
  }
  if (pathname === normalizedBase) return '/'
  return pathname
}

function writeJson(data: onRequestPayload, statusCode: number, body: unknown) {
  data.response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  data.response.end(JSON.stringify(body))
}

export class RuntimeHttpExtension implements Extension {
  constructor(
    private readonly basePath: string,
    private readonly getStatus: StatusGetter
  ) {}

  async onRequest(data: onRequestPayload): Promise<void> {
    const url = new URL(data.request.url || '/', 'http://localhost')
    const pathname = normalizePath(url.pathname, this.basePath)

    if (pathname === '/healthz' || pathname === '/api/v1/collab/health') {
      writeJson(data, 200, {
        code: 0,
        message: 'ok',
        data: {
          healthy: true,
          ...this.getStatus()
        }
      })
      throw null
    }

    if (pathname === '/api/v1/collab/runtime') {
      writeJson(data, 200, {
        code: 0,
        message: 'ok',
        data: this.getStatus()
      })
      throw null
    }

    if (pathname === '/api/v1/collab/providers') {
      writeJson(data, 200, {
        code: 0,
        message: 'ok',
        data: {
          active: this.getStatus().provider,
          available: ['hocuspocus']
        }
      })
      throw null
    }
  }
}
