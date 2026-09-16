import { randomUUID } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { getSystemParameter } from './systemParameters'

type JobEnvelope = { code?: number, data?: Record<string, unknown> }
type ConnectorError = { statusCode?: unknown, response?: { status?: unknown }, data?: { message?: unknown } }
const connectorFetch = fetchExternal as unknown as (url: string, options: Record<string, unknown>) => Promise<JobEnvelope>

function runtimeUrl(value: unknown) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  try {
    const url = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    return (url.protocol === 'https:' || (loopback && url.protocol === 'http:'))
      && !url.username && !url.password && !url.search && !url.hash
      ? url.toString().replace(/\/+$/, '')
      : ''
  } catch {
    return ''
  }
}

export async function startConnectorDingTalkDirectoryProfileSync(event: H3Event) {
  const url = runtimeUrl(await getSystemParameter('connector.runtimeApiUrl').catch(() => null))
  if (!url) throw createError({ statusCode: 503, message: 'Enterprise Connector Runtime 地址未配置或不安全' })
  const token = await requestServiceAccessToken({
    event,
    audience: 'connector-runtime',
    scope: 'connector-runtime:directory:sync'
  })
  try {
    const response = await connectorFetch(`${url}/v1/directory-profile-sync-jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10_000,
      body: {
        provider: 'dingtalk',
        integrationCode: 'dingtalk.default',
        idempotencyKey: `console-dingtalk-directory-${randomUUID()}`
      }
    })
    if (response.code !== 0 || !response.data?.jobId) throw new Error('invalid job response')
    return response.data
  } catch (error) {
    const failure = error as ConnectorError
    const remoteStatus = Number(failure.statusCode || failure.response?.status || 0)
    const statusCode = remoteStatus >= 400 && remoteStatus < 500 ? remoteStatus : 502
    const remoteMessage = typeof failure.data?.message === 'string' ? failure.data.message.trim() : ''
    throw createError({
      statusCode,
      message: `钉钉目录姓名同步任务创建失败：${remoteMessage || 'Connector Runtime 暂不可用'}`
    })
  }
}
