import { randomUUID } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { isPeopleManagedConnectorJob } from './connectorPeopleJobBoundary'
import { getSystemParameter } from './systemParameters'

type JobEnvelope = { code?: number, data?: Record<string, unknown> }
type ConnectorFetch = (
  url: string,
  options: Record<string, unknown>
) => Promise<JobEnvelope>

const connectorFetch = fetchExternal as unknown as ConnectorFetch

type ConnectorError = {
  statusCode?: unknown
  response?: { status?: unknown }
  data?: { message?: unknown }
}

function jobId(value: unknown) {
  const normalized = String(value || '').trim()
  if (!/^crj_[A-Za-z0-9_-]{20,64}$/.test(normalized)) {
    throw createError({ statusCode: 400, message: 'jobId 无效' })
  }
  return normalized
}

function connectorFailure(error: unknown, action: string) {
  const failure = error as ConnectorError
  const remoteStatus = Number(failure.statusCode || failure.response?.status || 0)
  const statusCode = remoteStatus >= 400 && remoteStatus < 500 ? remoteStatus : 502
  const remoteMessage = typeof failure.data?.message === 'string' ? failure.data.message.trim() : ''
  return createError({
    statusCode,
    message: `${action}失败：${remoteMessage || 'Connector Runtime 暂不可用'}`
  })
}

function runtimeUrl(value: unknown) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  try {
    const url = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    const secure = url.protocol === 'https:' || (loopback && url.protocol === 'http:')
    const clean = !url.username && !url.password && !url.search && !url.hash
    return secure && clean ? url.toString().replace(/\/+$/, '') : ''
  } catch {
    return ''
  }
}

async function connectorRuntimeUrl() {
  const url = runtimeUrl(await getSystemParameter('connector.runtimeApiUrl').catch(() => null))
  if (!url) {
    throw createError({ statusCode: 503, message: 'Enterprise Connector Runtime 地址未配置或不安全' })
  }
  return url
}

export async function startConnectorPeopleSync(event: H3Event, input: { objectScopes?: unknown, idempotencyKey?: unknown, originalActorUid?: unknown }) {
  const url = await connectorRuntimeUrl()
  const token = await requestServiceAccessToken({ event, audience: 'connector-runtime', scope: 'connector-runtime:people:sync' })
  const requestedScopes = Array.isArray(input.objectScopes) ? input.objectScopes.map(String) : ['organization', 'people']
  const idempotencyKey = String(input.idempotencyKey || `console-dingtalk-people-${randomUUID()}`).trim()
  try {
    const response = await connectorFetch(`${url}/v1/people-sync-jobs`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
      timeout: 10000,
      body: {
        provider: 'dingtalk',
        integrationCode: 'dingtalk.default',
        objectScopes: requestedScopes,
        idempotencyKey,
        originalActorUid: String(input.originalActorUid || '').trim()
      }
    })
    if (response.code !== 0 || !response.data?.jobId) {
      throw new Error('invalid job response')
    }
    return response.data
  } catch (error) {
    throw connectorFailure(error, '钉钉 People 同步任务创建')
  }
}

export async function getConnectorPeopleSync(event: H3Event, jobIdValue: unknown) {
  const normalizedJobId = jobId(jobIdValue)
  const url = await connectorRuntimeUrl()
  const token = await requestServiceAccessToken({
    event,
    audience: 'connector-runtime',
    scope: 'connector-runtime:jobs:view'
  })
  let job: Record<string, unknown>
  try {
    const response = await connectorFetch(`${url}/v1/people-sync-jobs/${encodeURIComponent(normalizedJobId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000
    })
    if (response.code !== 0 || !response.data?.jobId) {
      throw new Error('invalid job response')
    }
    job = response.data
  } catch (error) {
    throw connectorFailure(error, '读取钉钉 People 同步进度')
  }
  if (!isPeopleManagedConnectorJob(job)) {
    throw createError({ statusCode: 403, message: '该任务不属于 People 人事事实源同步' })
  }
  return job
}

export async function cancelConnectorPeopleSync(event: H3Event, jobIdValue: unknown, originalActorUid: unknown, idempotencyKeyValue: unknown) {
  const normalizedJobId = jobId(jobIdValue)
  await getConnectorPeopleSync(event, normalizedJobId)
  const url = await connectorRuntimeUrl()
  const token = await requestServiceAccessToken({
    event,
    audience: 'connector-runtime',
    scope: 'connector-runtime:jobs:cancel'
  })
  const idempotencyKey = String(idempotencyKeyValue || '').trim()
  try {
    const response = await connectorFetch(`${url}/v1/people-sync-jobs/${encodeURIComponent(normalizedJobId)}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
      timeout: 10000,
      body: { originalActorUid: String(originalActorUid || '').trim(), idempotencyKey }
    })
    if (response.code !== 0 || !response.data?.jobId) {
      throw new Error('invalid job response')
    }
    return response.data
  } catch (error) {
    throw connectorFailure(error, '取消钉钉 People 同步任务')
  }
}

export async function retryConnectorPeopleSync(event: H3Event, jobIdValue: unknown, originalActorUid: unknown, idempotencyKeyValue: unknown) {
  const normalizedJobId = jobId(jobIdValue)
  await getConnectorPeopleSync(event, normalizedJobId)
  const url = await connectorRuntimeUrl()
  const token = await requestServiceAccessToken({
    event,
    audience: 'connector-runtime',
    scope: 'connector-runtime:people:sync'
  })
  const idempotencyKey = String(idempotencyKeyValue || '').trim()
  try {
    const response = await connectorFetch(`${url}/v1/people-sync-jobs/${encodeURIComponent(normalizedJobId)}/retry`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
      timeout: 10000,
      body: { originalActorUid: String(originalActorUid || '').trim(), idempotencyKey }
    })
    if (response.code !== 0 || !response.data?.jobId) {
      throw new Error('invalid job response')
    }
    return response.data
  } catch (error) {
    throw connectorFailure(error, '重试钉钉 People 同步任务')
  }
}
