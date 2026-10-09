import { createError, type H3Event } from 'h3'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { getSystemParameter } from './systemParameters'

interface DiagnosticsEnvelope {
  code?: number
  data?: Record<string, unknown>
}

type DiagnosticsFetch = (
  url: string,
  options: Record<string, unknown>
) => Promise<DiagnosticsEnvelope>

const fetchDiagnostics = fetchExternal as unknown as DiagnosticsFetch

function runtimeUrl(value: unknown) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  try {
    const url = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    const safe = (url.protocol === 'https:' || (loopback && url.protocol === 'http:'))
      && !url.username && !url.password && !url.search && !url.hash
    return safe ? url.toString().replace(/\/+$/, '') : ''
  } catch {
    return ''
  }
}

export async function readConnectorRuntimeDiagnostics(event: H3Event) {
  const url = runtimeUrl(await getSystemParameter('connector.runtimeApiUrl').catch(() => null))
  if (!url) throw createError({ statusCode: 503, message: 'Enterprise Connector Runtime 地址未配置或不安全' })
  const token = await requestServiceAccessToken({
    event,
    audience: 'connector-runtime',
    scope: 'connector-runtime:diagnostics:view'
  })
  try {
    const response = await fetchDiagnostics(`${url}/v1/diagnostics`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000
    })
    if (response.code !== 0 || !response.data?.metrics) throw new Error('invalid diagnostics response')
    return response.data
  } catch {
    throw createError({ statusCode: 503, message: 'Connector Runtime 诊断暂不可用' })
  }
}
